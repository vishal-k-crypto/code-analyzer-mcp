/**
 * Main Orchestrator
 * Coordinates all subsystems and manages the orchestration loop
 */

import { StatePersistence } from '../subsystems/state-manager/index.js';
import { ContextAssembler, generateBoundedContextPrompt } from '../subsystems/context-injector/index.js';
import { ExecutionSandbox } from '../subsystems/execution-sandbox/index.js';
import { GapDetector, RequirementParser } from '../subsystems/gap-analyzer/index.js';
import { TaskDecomposer } from '../subsystems/roadmap-generator/index.js';
import { ScoreCalculator } from '../subsystems/scoring-engine/index.js';
import { StateMachine, type StateTransition } from './state-machine.js';
import type { 
  OrchestratorState, 
  ProjectGoal, 
  Task, 
  ErrorEntry,
  State 
} from '../types/state.js';
import type { ModifiedFile } from '../types/task.js';
import type { ParsedRequirement } from '../types/gap.js';
import { randomUUID } from 'crypto';

export interface OrchestratorConfig {
  projectPath: string;
  qualityThreshold?: number;
  maxRetries?: number;
}

export class Orchestrator {
  private config: OrchestratorConfig;
  private stateManager: StatePersistence;
  private contextAssembler: ContextAssembler;
  private executionSandbox: ExecutionSandbox;
  private gapDetector: GapDetector;
  private requirementParser: RequirementParser;
  private taskDecomposer: TaskDecomposer;
  private scoreCalculator: ScoreCalculator;
  private stateMachine: StateMachine;

  private state: OrchestratorState;
  private initialized = false;

  constructor(config: OrchestratorConfig) {
    this.config = {
      qualityThreshold: 85,
      maxRetries: 5,
      ...config
    };

    // Initialize subsystems
    this.stateManager = new StatePersistence(config.projectPath);
    this.contextAssembler = new ContextAssembler(config.projectPath);
    this.executionSandbox = new ExecutionSandbox(config.projectPath);
    this.gapDetector = new GapDetector(config.projectPath);
    this.requirementParser = new RequirementParser();
    this.taskDecomposer = new TaskDecomposer();
    this.scoreCalculator = new ScoreCalculator({ 
      projectPath: config.projectPath,
      contextAssembler: this.contextAssembler,
      enableTargetedTesting: true
    });
    this.stateMachine = new StateMachine();

    // Will be loaded in init()
    this.state = this.createEmptyState();
  }

  /**
   * Initialize the orchestrator
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.state = await this.stateManager.loadState();
    
    // If project path changed, update it
    if (this.state.projectPath !== this.config.projectPath) {
      this.state.projectPath = this.config.projectPath;
      await this.saveState();
    }

    this.initialized = true;
  }

  /**
   * Ingest a new project goal
   * Can accept either a raw goal string or pre-parsed structured requirements
   */
  async ingestGoal(
    description: string, 
    constraints: string[] = [],
    structuredRequirements?: ParsedRequirement[]
  ): Promise<{ method: 'llm' | 'rule-based' | 'provided'; count: number }> {
    await this.ensureInitialized();

    let requirements: ParsedRequirement[];
    let method: 'llm' | 'rule-based' | 'provided';

    // Use provided structured requirements if available
    if (structuredRequirements && structuredRequirements.length > 0) {
      requirements = structuredRequirements;
      method = 'provided';
    } else {
      // Parse requirements (may use LLM if available)
      const parseResult = await this.requirementParser.parseWithMethod(description);
      requirements = parseResult.requirements;
      method = parseResult.method;
    }

    // Create project goal
    const goal: ProjectGoal = {
      id: randomUUID(),
      description,
      requirements: requirements.map(r => ({
        ...r,
        weight: 1,
        verified: false,
        partiallyMet: false
      })),
      constraints: constraints.map((c, i) => ({
        id: `constraint-${i}`,
        description: c,
        type: 'technical'
      })),
      targetMetrics: {
        qualityThreshold: this.config.qualityThreshold!,
        maxIterations: 100,
        timeoutMinutes: 60
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Update state
    this.state.projectGoal = goal;
    this.state.progress.currentState = 'ANALYZE_GAPS';

    // Trigger gap analysis
    await this.analyzeGaps();

    await this.saveState();

    return {
      method,
      count: requirements.length
    };
  }

  /**
   * Analyze gaps between goal and current state
   */
  private async analyzeGaps(): Promise<void> {
    // Build file index with semantic embeddings before gap analysis
    // This ensures vector search is available for context assembly
    await this.contextAssembler.buildFileIndex();

    const gaps = await this.gapDetector.detectGaps(this.state.projectGoal);

    // Transition to planning
    this.transitionState({ type: 'GAPS_DETECTED' });
    await this.planRoadmap(gaps);
  }

  /**
   * Generate roadmap from gaps
   */
  private async planRoadmap(gaps: import('../types/gap.js').Gap[]): Promise<void> {
    const { phases, tasks } = this.taskDecomposer.generateRoadmap(gaps);

    this.state.taskQueue.phases = phases;
    this.state.taskQueue.pending = tasks;
    this.state.taskQueue.dependencies = new Map();

    this.transitionState({ type: 'ROADMAP_CREATED' });
    await this.saveState();
  }

  /**
   * Get the next target/task for execution
   * Respects the dependency graph - only returns tasks whose dependencies are satisfied
   */
  async getNextTarget(_sessionId: string): Promise<{ task: Task | null; context: string }> {
    await this.ensureInitialized();

    // If no pending tasks, check if we need to score
    if (this.state.taskQueue.pending.length === 0) {
      if (this.state.progress.currentState === 'EXECUTE_SESSION') {
        // Transition to scoring
        this.transitionState({ type: 'VERIFICATION_PASSED' });
        await this.scoreProject();
        
        if (this.state.progress.currentState === 'COMPLETE' as typeof this.state.progress.currentState) {
          return { task: null, context: 'Project complete! Score: ' + this.state.progress.completionScore };
        }
      }

      return { task: null, context: 'No pending tasks. Call orchestrator_get_score to check status.' };
    }

    // Get completed task IDs for dependency checking
    const completedTaskIds = new Set(this.state.progress.completedTasks.map(t => t.id));
    
    // Find the first task with satisfied dependencies
    let taskIndex = -1;
    let task: Task | null = null;
    
    for (let i = 0; i < this.state.taskQueue.pending.length; i++) {
      const candidate = this.state.taskQueue.pending[i];
      const depsSatisfied = candidate.dependencies.every(depId => completedTaskIds.has(depId));
      
      if (depsSatisfied) {
        taskIndex = i;
        task = candidate;
        break;
      }
    }
    
    // If no task has satisfied dependencies, return a waiting message
    if (!task || taskIndex === -1) {
      // Check if there are circular dependencies or blocked tasks
      const blockedTasks = this.state.taskQueue.pending.filter(t => 
        !t.dependencies.every(depId => completedTaskIds.has(depId))
      );
      
      const blockedInfo = blockedTasks.map(t => {
        const unmetDeps = t.dependencies.filter(depId => !completedTaskIds.has(depId));
        return `- "${t.title}" waiting for: ${unmetDeps.join(', ')}`;
      }).join('\n');
      
      return { 
        task: null, 
        context: `No tasks ready for execution. Waiting for dependencies:\n${blockedInfo}\n\nSome dependency tasks may need to be completed first.` 
      };
    }

    // Remove the selected task from pending
    this.state.taskQueue.pending.splice(taskIndex, 1);
    task.status = 'in_progress';
    this.state.taskQueue.inProgress = task;

    this.transitionState({ type: 'TASK_ASSIGNED', task });
    await this.saveState();

    // Assemble context
    const boundedContext = await this.contextAssembler.assembleContext(
      task,
      this.state.projectGoal,
      this.state.progress.completedTasks
    );

    // Update task with assembled context
    task.context = boundedContext;

    // Generate prompt
    const context = generateBoundedContextPrompt({
      projectGoal: this.state.projectGoal,
      task,
      boundedContext,
      phase: {
        current: task.phase,
        total: this.state.taskQueue.phases.length,
        title: this.state.taskQueue.phases.find(p => p.number === task.phase)?.title || `Phase ${task.phase}`
      },
      completedCount: this.state.progress.completedTasks.length,
      totalCount: this.state.progress.completedTasks.length + 
                  this.state.taskQueue.pending.length + 1 +
                  this.state.taskQueue.failed.length
    });

    return { task, context };
  }

  /**
   * Submit task result
   */
  async submitResult(
    taskId: string,
    files: ModifiedFile[],
    _notes?: string
  ): Promise<{ success: boolean; verificationResults: string }> {
    await this.ensureInitialized();

    const task = this.state.taskQueue.inProgress;
    if (!task || task.id !== taskId) {
      return { success: false, verificationResults: 'Task not found or not in progress' };
    }

    // Validate that no forbidden files are being modified
    const forbiddenViolations: string[] = [];
    for (const file of files) {
      // Check if file is in the forbidden list
      if (task.context.forbiddenFiles.includes(file.path)) {
        forbiddenViolations.push(file.path);
      }
    }

    if (forbiddenViolations.length > 0) {
      return {
        success: false,
        verificationResults: `FORBIDDEN FILES VIOLATION: The following files are forbidden and cannot be modified:\n${forbiddenViolations.map(f => `  - ${f}`).join('\n')}\n\nPlease remove these files from your submission and try again.`
      };
    }

    // Write modified files
    for (const file of files) {
      try {
        const { promises: fs } = await import('fs');
        const { dirname } = await import('path');
        // fileURLToPath not needed
        
        const fullPath = `${this.config.projectPath}/${file.path}`;
        await fs.mkdir(dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content, 'utf-8');
      } catch (error) {
        return { 
          success: false, 
          verificationResults: `Failed to write file ${file.path}: ${error}` 
        };
      }
    }

    // Run verification
    const verification = await this.verifyOutput(task);

    if (verification.success) {
      // Mark task complete
      task.status = 'completed';
      task.completedAt = new Date();
      this.state.progress.completedTasks.push(task);
      this.state.taskQueue.inProgress = null;

      this.transitionState({ type: 'TASK_COMPLETED', taskId });
    } else {
      // Mark task failed
      task.status = 'failed';
      task.attempts++;
      
      if (task.attempts >= (this.config.maxRetries || 5)) {
        // Max retries exceeded, move to failed queue
        this.state.taskQueue.failed.push(task);
        this.state.taskQueue.inProgress = null;
      }

      const error: ErrorEntry = {
        id: randomUUID(),
        taskId: task.id,
        type: 'test',
        severity: 'error',
        message: verification.output,
        timestamp: new Date(),
        resolved: false
      };

      this.state.errorLog.entries.push(error);
      this.transitionState({ type: 'TASK_FAILED', taskId, error });
    }

    await this.saveState();

    return {
      success: verification.success,
      verificationResults: verification.output
    };
  }

  /**
   * Verify task output
   */
  private async verifyOutput(task: Task): Promise<{ success: boolean; output: string }> {
    const results: string[] = [];
    let allPassed = true;

    for (const cmd of task.verificationCommands) {
      const [command, ...args] = cmd.split(' ');
      const result = await this.executionSandbox.execute(command, args);

      results.push(`$ ${cmd}`);
      results.push(result.success ? '✓ PASSED' : '✗ FAILED');
      if (result.stdout) results.push(result.stdout);
      if (result.stderr) results.push(result.stderr);
      results.push('');

      if (!result.success) {
        allPassed = false;
      }
    }

    return {
      success: allPassed,
      output: results.join('\n')
    };
  }

  /**
   * Score the project
   */
  private async scoreProject(): Promise<void> {
    const { score } = await this.scoreCalculator.calculateScore(this.state);

    this.state.progress.completionScore = score;

    this.transitionState({ type: 'SCORE_CALCULATED', score });
    await this.saveState();
  }

  /**
   * Force retry a failed task
   */
  async forceRetry(taskId: string, _error?: string): Promise<void> {
    await this.ensureInitialized();

    const failedTask = this.state.taskQueue.failed.find(t => t.id === taskId);
    if (!failedTask) {
      throw new Error(`Failed task not found: ${taskId}`);
    }

    // Remove from failed and add back to pending
    this.state.taskQueue.failed = this.state.taskQueue.failed.filter(t => t.id !== taskId);
    failedTask.status = 'pending';
    failedTask.attempts = 0;
    this.state.taskQueue.pending.unshift(failedTask);

    await this.saveState();
  }

  /**
   * Get current status
   */
  getStatus(): {
    state: State;
    score: number;
    pendingTasks: number;
    completedTasks: number;
    failedTasks: number;
    currentTask: Task | null;
  } {
    return {
      state: this.state.progress.currentState,
      score: this.state.progress.completionScore,
      pendingTasks: this.state.taskQueue.pending.length,
      completedTasks: this.state.progress.completedTasks.length,
      failedTasks: this.state.taskQueue.failed.length,
      currentTask: this.state.taskQueue.inProgress
    };
  }

  /**
   * Get detailed score breakdown
   */
  getScore(): { score: number; breakdown: import('../types/state.js').ScoreBreakdown | null } {
    // Would return cached breakdown from last calculation
    return {
      score: this.state.progress.completionScore,
      breakdown: null // Would store and return actual breakdown
    };
  }

  /**
   * List all tasks
   */
  listTasks(filter?: 'pending' | 'completed' | 'failed' | 'all'): Task[] {
    const filterVal = filter || 'all';
    
    switch (filterVal) {
      case 'pending':
        return this.state.taskQueue.pending;
      case 'completed':
        return this.state.progress.completedTasks;
      case 'failed':
        return this.state.taskQueue.failed;
      case 'all':
      default:
        return [
          ...this.state.taskQueue.pending,
          ...(this.state.taskQueue.inProgress ? [this.state.taskQueue.inProgress] : []),
          ...this.state.progress.completedTasks,
          ...this.state.taskQueue.failed
        ];
    }
  }

  /**
   * Reset orchestrator state
   */
  async reset(confirm: boolean): Promise<void> {
    if (!confirm) {
      throw new Error('Must pass confirm=true to reset');
    }

    this.state = this.createEmptyState();
    await this.saveState();
  }

  /**
   * Create a checkpoint
   */
  async createCheckpoint(name?: string): Promise<string> {
    return this.stateManager.createCheckpoint(name);
  }

  /**
   * Restore from checkpoint
   */
  async restoreCheckpoint(checkpointId: string): Promise<void> {
    this.state = await this.stateManager.restoreCheckpoint(checkpointId);
  }

  /**
   * Ensure orchestrator is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Save current state
   */
  private async saveState(): Promise<void> {
    await this.stateManager.persistState(this.state);
  }

  /**
   * Transition state machine
   */
  private transitionState(transition: StateTransition): void {
    const newState = this.stateMachine.getNextState(
      this.state.progress.currentState,
      transition
    );
    this.state.progress.currentState = newState;
  }

  /**
   * Create empty state
   */
  private createEmptyState(): OrchestratorState {
    return {
      projectGoal: null,
      progress: {
        currentState: 'IDLE',
        completedTasks: [],
        currentTask: null,
        completionScore: 0,
        lastVerifiedAt: null
      },
      taskQueue: {
        phases: [],
        pending: [],
        inProgress: null,
        failed: [],
        dependencies: new Map()
      },
      errorLog: {
        entries: [],
        patterns: [],
        retryCount: new Map()
      },
      projectPath: this.config.projectPath
    };
  }
}
