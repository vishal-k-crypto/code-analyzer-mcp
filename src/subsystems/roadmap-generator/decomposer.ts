/**
 * Task Decomposer
 * PHASE 4: Breaks down gaps into atomic tasks with proper dependency graph
 * 
 * FIX: Tracks "Created Artifacts" explicitly to handle dependencies before files exist on disk.
 * 
 * DEPENDENCY RESOLUTION:
 * 1. Explicit dependencies from ParsedRequirement (requirement.dependencies)
 * 2. Implicit dependencies based on shared files (existing files)
 * 3. PHASE 4: Created Artifacts - If Task A promises to create auth.ts, Task B depending on auth.ts
 *    gets a dependency link BEFORE auth.ts physically exists
 * 4. Implicit dependencies for test tasks (test depends on implementation)
 * 5. Phase-based constraints (lower phase tasks are dependencies for higher phase tasks)
 */

import type { Gap } from '../../types/gap.js';
import type { Task, Phase, BoundedContext } from '../../types/state.js';

interface TaskWithDeps {
  task: Task;
  /** Set of task IDs this task depends on */
  dependsOn: Set<string>;
  /** Set of task IDs that depend on this task */
  dependedBy: Set<string>;
}

/**
 * PHASE 4: Tracks artifacts (files, components) that will be created by tasks
 */
interface CreatedArtifact {
  taskId: string;
  artifactName: string; // e.g., "auth.ts", "LoginComponent"
  artifactType: 'file' | 'component' | 'function' | 'class';
}

export class TaskDecomposer {
  private taskCounter = 0;
  private requirementToTaskMap = new Map<string, string>(); // Maps requirementId -> taskId
  
  // PHASE 4: Track created artifacts for dependency resolution
  private createdArtifacts = new Map<string, CreatedArtifact>(); // artifactName -> CreatedArtifact
  private gapMap = new Map<string, Gap>(); // taskId -> Gap mapping

  /**
   * PHASE 4: Extract component/file names from a text
   */
  private extractArtifactNames(text: string): string[] {
    const artifacts: string[] = [];
    
    // Match file paths (e.g., "auth.ts", "utils/helpers.js")
    const filePattern = /[\w/\\.-]+\.(ts|tsx|js|jsx|py|rs|go|java|rb|php)/gi;
    const fileMatches = text.match(filePattern) || [];
    artifacts.push(...fileMatches);
    
    // Match PascalCase class/component names (e.g., "LoginComponent", "AuthService")
    const classPattern = /\b([A-Z][a-zA-Z0-9]*(?:Component|Service|Controller|Model|Helper|Util|Manager|Handler))\b/g;
    const classMatches = text.match(classPattern) || [];
    artifacts.push(...classMatches);
    
    // Match camelCase function names followed by descriptions (e.g., "create login function")
    const funcPattern = /(?:create|implement|add)\s+(?:a\s+)?(?:function\s+)?(?:called\s+)?([a-z][a-zA-Z0-9]*)/gi;
    let match;
    while ((match = funcPattern.exec(text)) !== null) {
      artifacts.push(match[1]);
    }
    
    return [...new Set(artifacts)]; // Remove duplicates
  }

  /**
   * PHASE 4: Register artifacts that a task will create
   */
  private registerCreatedArtifacts(task: Task, gap: Gap): void {
    const artifactsToRegister: CreatedArtifact[] = [];
    
    // 1. Register files from relevantFiles context
    for (const file of task.context.relevantFiles) {
      artifactsToRegister.push({
        taskId: task.id,
        artifactName: file,
        artifactType: 'file'
      });
    }
    
    // 2. Register components from gap's missingParts
    if (gap.missingParts) {
      for (const part of gap.missingParts) {
        // Extract potential component/function names
        const extractedArtifacts = this.extractArtifactNames(part);
        for (const artifact of extractedArtifacts) {
          const type = artifact.includes('.') ? 'file' : 
                       artifact[0] === artifact[0].toUpperCase() ? 'component' : 'function';
          artifactsToRegister.push({
            taskId: task.id,
            artifactName: artifact,
            artifactType: type as 'file' | 'component' | 'function'
          });
        }
      }
    }
    
    // 3. Register from requirement components
    if (gap.requirement?.components) {
      for (const component of gap.requirement.components) {
        const extractedArtifacts = this.extractArtifactNames(component);
        for (const artifact of extractedArtifacts) {
          const type = artifact.includes('.') ? 'file' : 
                       artifact[0] === artifact[0].toUpperCase() ? 'component' : 'function';
          artifactsToRegister.push({
            taskId: task.id,
            artifactName: artifact,
            artifactType: type as 'file' | 'component' | 'function'
          });
        }
      }
    }
    
    // 4. Register from expected output
    if (task.context.expectedOutput) {
      const extractedArtifacts = this.extractArtifactNames(task.context.expectedOutput);
      for (const artifact of extractedArtifacts) {
        artifactsToRegister.push({
          taskId: task.id,
          artifactName: artifact,
          artifactType: artifact.includes('.') ? 'file' : 'component'
        });
      }
    }
    
    // Store artifacts (only if not already registered - first task to create it wins)
    for (const artifact of artifactsToRegister) {
      if (!this.createdArtifacts.has(artifact.artifactName)) {
        this.createdArtifacts.set(artifact.artifactName, artifact);
      }
    }
    
    // Store gap mapping for this task
    this.gapMap.set(task.id, gap);
  }

  /**
   * PHASE 4: Find dependencies based on created artifacts
   * If Task B needs auth.ts and Task A creates auth.ts, Task B depends on Task A
   */
  private findArtifactBasedDependencies(task: Task, gap: Gap): string[] {
    const dependencies: string[] = [];
    
    // Get all artifacts this task might need
    const neededArtifacts: string[] = [];
    
    // From gap's existing files (imports from files not yet created)
    if (gap.existingFiles) {
      neededArtifacts.push(...gap.existingFiles);
    }
    
    // From requirement description (extract potential dependencies)
    if (gap.requirement?.description) {
      neededArtifacts.push(...this.extractArtifactNames(gap.requirement.description));
    }
    
    // From task description
    neededArtifacts.push(...this.extractArtifactNames(task.description));
    
    // Check if any needed artifact is created by another task
    for (const artifact of neededArtifacts) {
      const creator = this.createdArtifacts.get(artifact);
      if (creator && creator.taskId !== task.id) {
        dependencies.push(creator.taskId);
      }
    }
    
    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Generate a roadmap from detected gaps
   * Uses topological sorting to ensure correct task ordering
   */
  generateRoadmap(gaps: Gap[]): { phases: Phase[]; tasks: Task[] } {
    this.taskCounter = 0;
    this.requirementToTaskMap.clear();
    this.createdArtifacts.clear(); // PHASE 4: Reset artifact tracking
    this.gapMap.clear(); // PHASE 4: Reset gap mapping

    // Categorize gaps
    const categorized = {
      foundational: gaps.filter(g => g.type === 'MISSING_DEPENDENCY'),
      syntax: gaps.filter(g => g.type === 'SYNTAX_ERROR'),
      missing: gaps.filter(g => g.type === 'MISSING_IMPLEMENTATION'),
      partial: gaps.filter(g => g.type === 'PARTIAL_IMPLEMENTATION'),
      tests: gaps.filter(g => g.type === 'TEST_FAILURE')
    };

    // First pass: Create all tasks (without dependencies yet)
    const taskMap = new Map<string, TaskWithDeps>();

    // First pass: Create all tasks and register created artifacts (PHASE 4)
    
    // Phase 1: Foundation (dependencies, config)
    for (const gap of categorized.foundational) {
      const task = this.createTask(gap, 1);
      this.registerTask(taskMap, task, gap); // PHASE 4: Pass gap for artifact tracking
    }

    // Phase 2: Fix Broken (syntax errors)
    for (const gap of categorized.syntax) {
      const task = this.createTask(gap, 2);
      this.registerTask(taskMap, task, gap);
    }

    // Phase 3: Core Features (critical priority)
    const criticalMissing = categorized.missing.filter(
      g => g.priority === 'critical' || g.requirement?.priority === 'critical'
    );
    for (const gap of criticalMissing) {
      const task = this.createTask(gap, 3);
      this.registerTask(taskMap, task, gap);
    }

    // Phase 4: Partial Implementations
    for (const gap of categorized.partial) {
      const task = this.createTask(gap, 4);
      this.registerTask(taskMap, task, gap);
    }

    // Phase 5: Remaining Features + Tests
    const remainingMissing = categorized.missing.filter(
      g => g.priority !== 'critical' && g.requirement?.priority !== 'critical'
    );
    for (const gap of remainingMissing) {
      const task = this.createTask(gap, 5);
      this.registerTask(taskMap, task, gap);
    }
    for (const gap of categorized.tests) {
      const task = this.createTask(gap, 5);
      this.registerTask(taskMap, task, gap);
    }

    // Second pass: Build dependency graph
    this.buildDependencyGraph(taskMap);

    // Third pass: Topological sort to get execution order
    const sortedTasks = this.topologicalSort(taskMap);

    // Fourth pass: Group into phases based on topological levels
    const phases = this.buildPhases(sortedTasks);

    return { phases, tasks: sortedTasks };
  }

  /**
   * PHASE 4: Register a task in the task map with artifact tracking
   */
  private registerTask(taskMap: Map<string, TaskWithDeps>, task: Task, gap?: Gap): void {
    taskMap.set(task.id, {
      task,
      dependsOn: new Set(),
      dependedBy: new Set()
    });

    // Track requirement ID mapping for explicit dependency resolution
    if (task.requirementId) {
      this.requirementToTaskMap.set(task.requirementId, task.id);
    }
    
    // PHASE 4: Register artifacts this task will create
    if (gap) {
      this.registerCreatedArtifacts(task, gap);
    }
  }

  /**
   * Create a task from a gap
   */
  private createTask(gap: Gap, phaseNumber: number): Task {
    this.taskCounter++;
    const id = `task-${Date.now()}-${this.taskCounter}`;

    const title = this.generateTitle(gap);
    const description = this.generateDescription(gap);
    const acceptanceCriteria = this.generateCriteria(gap);
    const context = this.generateContext(gap);
    const verificationCommands = this.determineVerificationCommands(gap);

    return {
      id,
      phase: phaseNumber,
      title,
      description,
      acceptanceCriteria,
      context,
      verificationCommands,
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
      completedAt: null,
      dependencies: [], // Will be populated during dependency resolution
      requirementId: gap.requirement?.id
    };
  }

  /**
   * Build the complete dependency graph
   */
  private buildDependencyGraph(taskMap: Map<string, TaskWithDeps>): void {
    const tasks = Array.from(taskMap.values()).map(twd => twd.task);

    for (const [taskId, taskWithDeps] of taskMap) {
      const task = taskWithDeps.task;

      // 1. Explicit dependencies from requirement.dependencies
      if (task.requirementId && task.requirementId.includes('.')) {
        // This is a sub-requirement, extract parent
        const parentId = task.requirementId.split('.').slice(0, -1).join('.');
        const parentTaskId = this.requirementToTaskMap.get(parentId);
        if (parentTaskId && parentTaskId !== taskId) {
          taskWithDeps.dependsOn.add(parentTaskId);
        }
      }

      // Check explicit dependencies in the gap's requirement
      const gapWithReq = this.findGapForTask(task);
      if (gapWithReq?.requirement?.dependencies) {
        for (const depReqId of gapWithReq.requirement.dependencies) {
          const depTaskId = this.requirementToTaskMap.get(depReqId);
          if (depTaskId && depTaskId !== taskId) {
            taskWithDeps.dependsOn.add(depTaskId);
          }
        }
      }

      // PHASE 4: Artifact-based dependencies
      // If Task A promises to create auth.ts, and Task B needs auth.ts,
      // Task B must depend on Task A (even before auth.ts physically exists)
      if (gapWithReq) {
        const artifactDeps = this.findArtifactBasedDependencies(task, gapWithReq);
        for (const depTaskId of artifactDeps) {
          if (depTaskId !== taskId) {
            taskWithDeps.dependsOn.add(depTaskId);
          }
        }
      }

      // 2. Implicit file-based dependencies (for existing files)
      // A task that modifies/creates a file is a dependency for tasks that use that file
      // Implementation tasks are dependencies for test tasks on the same files
      for (const otherTask of tasks) {
        if (otherTask.id === taskId) continue;

        // Task dependency logic continues...

        // Check for shared files
        const sharedFiles = task.context.relevantFiles.filter(f => 
          otherTask.context.relevantFiles.includes(f)
        );

        if (sharedFiles.length > 0) {
          // Test tasks depend on implementation tasks for the same files
          const isThisTest = this.isTestTask(task);
          const isOtherTest = this.isTestTask(otherTask);

          if (isThisTest && !isOtherTest) {
            // This is a test task, depends on implementation
            taskWithDeps.dependsOn.add(otherTask.id);
          } else if (!isThisTest && isOtherTest) {
            // Other is a test task, don't add reverse dependency here
          } else if (otherTask.phase < task.phase) {
            // Tasks in earlier phases are dependencies
            taskWithDeps.dependsOn.add(otherTask.id);
          } else if (otherTask.phase === task.phase && 
                     otherTask.createdAt < task.createdAt) {
            // Same phase, earlier created task is dependency
            taskWithDeps.dependsOn.add(otherTask.id);
          }
        }
      }

      // 3. Phase-based constraints: strictly enforce phase ordering
      // All tasks in earlier phases are potential dependencies
      const earlierPhaseTasks = tasks.filter(t => t.phase < task.phase);
      for (const earlierTask of earlierPhaseTasks) {
        // Only add if there's some logical connection or if it's a foundational phase
        if (earlierTask.phase <= 2 || this.hasLogicalConnection(task, earlierTask)) {
          taskWithDeps.dependsOn.add(earlierTask.id);
        }
      }
    }

    // Build reverse dependency links (dependedBy)
    for (const [taskId, taskWithDeps] of taskMap) {
      for (const depId of taskWithDeps.dependsOn) {
        const depTask = taskMap.get(depId);
        if (depTask) {
          depTask.dependedBy.add(taskId);
        }
      }
    }

    // Detect and break cycles
    this.breakCycles(taskMap);
  }

  /**
   * Find the gap that originated a task (for accessing requirement info)
   * PHASE 4: Uses the gapMap defined at class level
   */
  private findGapForTask(task: Task): Gap | undefined {
    return this.gapMap.get(task.id);
  }

  /**
   * Check if a task is a test-related task
   */
  private isTestTask(task: Task): boolean {
    const titleLower = task.title.toLowerCase();
    const descLower = task.description.toLowerCase();
    return titleLower.includes('test') || 
           titleLower.includes('spec') ||
           descLower.includes('unit test') ||
           descLower.includes('integration test') ||
           task.verificationCommands.some(cmd => cmd.includes('test'));
  }

  /**
   * Check if two tasks have a logical connection (share components, etc)
   */
  private hasLogicalConnection(task1: Task, task2: Task): boolean {
    // Check for shared file references
    const sharedFiles = task1.context.relevantFiles.filter(f => 
      task2.context.relevantFiles.includes(f)
    );
    return sharedFiles.length > 0;
  }

  /**
   * Detect and break dependency cycles
   * Uses a simple approach: remove the weakest dependency in each cycle
   */
  private breakCycles(taskMap: Map<string, TaskWithDeps>): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const detectCycle = (taskId: string, path: string[]): string[] | null => {
      visited.add(taskId);
      recursionStack.add(taskId);

      const taskWithDeps = taskMap.get(taskId);
      if (taskWithDeps) {
        for (const depId of taskWithDeps.dependsOn) {
          if (!visited.has(depId)) {
            const cycle = detectCycle(depId, [...path, taskId]);
            if (cycle) return cycle;
          } else if (recursionStack.has(depId)) {
            // Found a cycle
            const cycleStart = path.indexOf(depId);
            return [...path.slice(cycleStart), taskId];
          }
        }
      }

      recursionStack.delete(taskId);
      return null;
    };

    // Try to find and break cycles
    for (const taskId of taskMap.keys()) {
      if (!visited.has(taskId)) {
        let cycle: string[] | null;
        while ((cycle = detectCycle(taskId, [])) !== null) {
          // Break the cycle by removing the dependency from the last task to the first
          const lastTask = cycle[cycle.length - 1];
          const firstTask = cycle[0];
          const lastTaskWithDeps = taskMap.get(lastTask);
          if (lastTaskWithDeps) {
            lastTaskWithDeps.dependsOn.delete(firstTask);
          }
          // Reset for next detection
          visited.clear();
          recursionStack.clear();
        }
      }
    }
  }

  /**
   * Perform topological sort to get tasks in execution order
   * Uses Kahn's algorithm for efficiency
   */
  private topologicalSort(taskMap: Map<string, TaskWithDeps>): Task[] {
    const result: Task[] = [];
    const inDegree = new Map<string, number>();
    const queue: string[] = [];

    // Calculate in-degrees
    for (const [taskId, taskWithDeps] of taskMap) {
      const degree = taskWithDeps.dependsOn.size;
      inDegree.set(taskId, degree);
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    // Process queue
    while (queue.length > 0) {
      // Sort queue by phase and creation time for deterministic ordering
      queue.sort((a, b) => {
        const taskA = taskMap.get(a)!.task;
        const taskB = taskMap.get(b)!.task;
        if (taskA.phase !== taskB.phase) {
          return taskA.phase - taskB.phase;
        }
        return taskA.createdAt.getTime() - taskB.createdAt.getTime();
      });

      const taskId = queue.shift()!;
      const taskWithDeps = taskMap.get(taskId)!;
      
      // Update task with final dependencies list
      taskWithDeps.task.dependencies = Array.from(taskWithDeps.dependsOn);
      result.push(taskWithDeps.task);

      // Update in-degrees for dependent tasks
      for (const dependentId of taskWithDeps.dependedBy) {
        const newDegree = (inDegree.get(dependentId) || 0) - 1;
        inDegree.set(dependentId, newDegree);
        if (newDegree === 0) {
          queue.push(dependentId);
        }
      }
    }

    // Check for remaining tasks (shouldn't happen if cycles are broken)
    if (result.length !== taskMap.size) {
      const remaining = Array.from(taskMap.keys()).filter(id => 
        !result.some(t => t.id === id)
      );
      // Add remaining tasks with warnings
      for (const taskId of remaining) {
        const taskWithDeps = taskMap.get(taskId)!;
        taskWithDeps.task.dependencies = []; // Clear dependencies to break cycle
        result.push(taskWithDeps.task);
      }
    }

    return result;
  }

  /**
   * Build phases from topologically sorted tasks
   * Tasks are grouped by their 'level' in the dependency graph
   */
  private buildPhases(sortedTasks: Task[]): Phase[] {
    const phaseMap = new Map<number, Task[]>();

    // Group tasks by their original phase, but maintain execution order
    for (const task of sortedTasks) {
      if (!phaseMap.has(task.phase)) {
        phaseMap.set(task.phase, []);
      }
      phaseMap.get(task.phase)!.push(task);
    }

    const phaseTitles: Record<number, string> = {
      1: 'Foundation',
      2: 'Fix Broken',
      3: 'Core Features',
      4: 'Complete Partial',
      5: 'Tests & Polish'
    };

    return Array.from(phaseMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([number, phaseTasks]) => ({
        number,
        title: phaseTitles[number] || `Phase ${number}`,
        description: `Tasks for ${phaseTitles[number] || `phase ${number}`}`,
        tasks: phaseTasks
      }));
  }

  /**
   * Generate task title from gap
   */
  private generateTitle(gap: Gap): string {
    switch (gap.type) {
      case 'MISSING_DEPENDENCY':
        return `Fix missing dependency in ${gap.file || 'project'}`;
      case 'SYNTAX_ERROR':
        return `Fix syntax error in ${gap.file || 'source file'}`;
      case 'MISSING_IMPLEMENTATION':
        return gap.requirement 
          ? `Implement: ${gap.requirement.description.slice(0, 50)}`
          : 'Implement missing functionality';
      case 'PARTIAL_IMPLEMENTATION':
        return gap.requirement
          ? `Complete: ${gap.requirement.description.slice(0, 50)}`
          : 'Complete partial implementation';
      case 'TEST_FAILURE':
        return `Fix failing tests in ${gap.file || 'test suite'}`;
      default:
        return `Address: ${gap.type}`;
    }
  }

  /**
   * Generate task description from gap
   */
  private generateDescription(gap: Gap): string {
    const parts: string[] = [];

    switch (gap.type) {
      case 'MISSING_DEPENDENCY':
        parts.push(`The file ${gap.file} references a missing dependency.`);
        parts.push(`Missing: ${gap.missingParts.join(', ')}`);
        break;
      case 'SYNTAX_ERROR':
        parts.push(`Fix syntax errors in ${gap.file}.`);
        parts.push('Ensure the code compiles/parses correctly.');
        break;
      case 'MISSING_IMPLEMENTATION':
        if (gap.requirement) {
          parts.push(gap.requirement.description);
        }
        if (gap.missingParts.length > 0) {
          parts.push(`Implement the following components: ${gap.missingParts.join(', ')}`);
        }
        break;
      case 'PARTIAL_IMPLEMENTATION':
        if (gap.requirement) {
          parts.push(`Complete the implementation of: ${gap.requirement.description}`);
        }
        if (gap.missingParts.length > 0) {
          parts.push(`Missing parts: ${gap.missingParts.join(', ')}`);
        }
        break;
      case 'TEST_FAILURE':
        parts.push(`Fix the failing tests.`);
        break;
    }

    return parts.join('\n');
  }

  /**
   * Generate acceptance criteria from gap
   */
  private generateCriteria(gap: Gap): string[] {
    const criteria: string[] = [];

    switch (gap.type) {
      case 'MISSING_DEPENDENCY':
        criteria.push('All imports resolve correctly');
        criteria.push('No "module not found" errors');
        break;
      case 'SYNTAX_ERROR':
        criteria.push('Code compiles/parses without errors');
        criteria.push('Linter passes');
        break;
      case 'MISSING_IMPLEMENTATION':
      case 'PARTIAL_IMPLEMENTATION':
        if (gap.requirement?.acceptanceCriteria) {
          criteria.push(...gap.requirement.acceptanceCriteria.slice(0, 3));
        }
        if (criteria.length === 0) {
          criteria.push('Implementation matches requirements');
          criteria.push('Code follows project conventions');
        }
        break;
      case 'TEST_FAILURE':
        criteria.push('All tests pass');
        criteria.push('Code coverage maintained');
        break;
    }

    return criteria;
  }

  /**
   * Generate bounded context from gap
   */
  private generateContext(gap: Gap): BoundedContext {
    const relevantFiles: string[] = [];
    
    if (gap.file) {
      relevantFiles.push(gap.file);
    }
    if (gap.existingFiles) {
      relevantFiles.push(...gap.existingFiles);
    }
    if (gap.requirement?.components) {
      relevantFiles.push(...gap.requirement.components.map(c => 
        c.includes('.') ? c : `${c}.ts`
      ));
    }

    return {
      relevantFiles: [...new Set(relevantFiles)],
      forbiddenFiles: [],
      instructions: '',
      expectedOutput: gap.type === 'MISSING_IMPLEMENTATION' 
        ? 'New implementation files' 
        : 'Modified existing files'
    };
  }

  /**
   * Determine verification commands for gap
   */
  private determineVerificationCommands(gap: Gap): string[] {
    switch (gap.type) {
      case 'MISSING_DEPENDENCY':
        return ['npm install', 'tsc --noEmit'];
      case 'SYNTAX_ERROR':
        return ['tsc --noEmit'];
      case 'MISSING_IMPLEMENTATION':
      case 'PARTIAL_IMPLEMENTATION':
        return ['npm run build', 'npm test'];
      case 'TEST_FAILURE':
        return ['npm test'];
      default:
        return ['npm run build'];
    }
  }
}
