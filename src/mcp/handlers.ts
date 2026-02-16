/**
 * MCP Tool Handlers
 * Request handlers for orchestrator MCP tools
 */

import type { Orchestrator } from '../core/orchestrator.js';
import type { ParsedRequirement } from '../types/gap.js';

// Tool response matching MCP SDK requirements
export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface IngestGoalArgs {
  goal: string;
  projectPath?: string;
  constraints?: string[];
  structuredRequirements?: Array<{
    id?: string;
    description: string;
    type: 'feature' | 'bugfix' | 'refactor' | 'test';
    priority: 'critical' | 'high' | 'medium' | 'low';
    components?: string[];
    acceptanceCriteria?: string[];
    dependencies?: string[];
  }>;
}

export interface SubmitResultArgs {
  taskId: string;
  files: Array<{ path: string; content: string }>;
  notes?: string;
}

export interface NextTargetArgs {
  sessionId: string;
}

export interface ListTasksArgs {
  filter?: 'pending' | 'completed' | 'failed' | 'all';
}

export interface ForceRetryArgs {
  taskId: string;
  error?: string;
}

export interface ResetArgs {
  confirm: boolean;
}

export interface CheckpointArgs {
  name?: string;
}

export interface RestoreCheckpointArgs {
  checkpointId: string;
}

export interface GetScoreArgs {
  includeHistory?: boolean;
}

export interface VerifyArgs {
  verbose?: boolean;
}

/**
 * Tool handler functions
 */
export class ToolHandlers {
  constructor(private orchestrator: Orchestrator) {}

  /**
   * Handle orchestrator_ingest_goal
   */
  async handleIngestGoal(args: IngestGoalArgs): Promise<ToolResponse> {
    let parsedRequirements: ParsedRequirement[] | undefined;
    
    if (args.structuredRequirements && args.structuredRequirements.length > 0) {
      parsedRequirements = args.structuredRequirements.map((req, index) => ({
        id: req.id || `REQ-${index + 1}`,
        description: req.description,
        type: req.type,
        priority: req.priority,
        components: req.components || [],
        acceptanceCriteria: req.acceptanceCriteria || [],
        dependencies: req.dependencies || []
      }));
    }

    const result = await this.orchestrator.ingestGoal(
      args.goal,
      args.constraints || [],
      parsedRequirements
    );
    
    let methodText: string;
    switch (result.method) {
      case 'llm':
        methodText = '🤖 LLM-powered parsing';
        break;
      case 'rule-based':
        methodText = '📝 Rule-based parsing (set OPENAI_API_KEY or ANTHROPIC_API_KEY for better results)';
        break;
      case 'provided':
        methodText = '✓ Client-provided structured requirements';
        break;
    }
    
    return {
      content: [{
        type: 'text',
        text: `✓ Goal ingested successfully.

📊 Parsing Method: ${methodText}
📋 Requirements Extracted: ${result.count}

The orchestrator has analyzed your goal and created a roadmap.
Use 'orchestrator_next_target' to get the first task.`
      }]
    };
  }

  /**
   * Handle orchestrator_next_target
   */
  async handleNextTarget(args: NextTargetArgs): Promise<ToolResponse> {
    const { context } = await this.orchestrator.getNextTarget(args.sessionId);
    
    return {
      content: [{
        type: 'text',
        text: context
      }]
    };
  }

  /**
   * Handle orchestrator_submit_result
   */
  async handleSubmitResult(args: SubmitResultArgs): Promise<ToolResponse> {
    const result = await this.orchestrator.submitResult(
      args.taskId,
      args.files,
      args.notes
    );
    
    return {
      content: [{
        type: 'text',
        text: result.success 
          ? `✓ Task completed successfully!\n\n${result.verificationResults}\n\nUse 'orchestrator_next_target' to continue.`
          : `✗ Task verification failed.\n\n${result.verificationResults}\n\nPlease fix the issues and try again.`
      }]
    };
  }

  /**
   * Handle orchestrator_status
   */
  handleStatus(): ToolResponse {
    const status = this.orchestrator.getStatus();
    
    return {
      content: [{
        type: 'text',
        text: `📊 Project Status
────────────────
State: ${status.state}
Score: ${status.score}/100

Tasks:
  • Pending: ${status.pendingTasks}
  • Completed: ${status.completedTasks}
  • Failed: ${status.failedTasks}
${status.currentTask ? `\nCurrent Task: ${status.currentTask.title}` : ''}`
      }]
    };
  }

  /**
   * Handle orchestrator_get_score
   */
  handleGetScore(_args: GetScoreArgs): ToolResponse {
    const { score, breakdown } = this.orchestrator.getScore();
    
    let text = `🎯 Project Score: ${score}/100\n`;
    text += `──────────────────────\n`;
    
    if (breakdown) {
      text += `\nBreakdown:\n`;
      text += `  Requirements Coverage: ${breakdown.requirementsCoverage.toFixed(1)}%\n`;
      text += `  Test Pass Rate: ${breakdown.testPassRate.toFixed(1)}%\n`;
      text += `  Code Quality: ${breakdown.codeQuality.toFixed(1)}%\n`;
      text += `  Implementation: ${breakdown.implementationCompleteness.toFixed(1)}%\n`;
      if (breakdown.penalties > 0) {
        text += `  Penalties: -${breakdown.penalties}\n`;
      }
    }

    return {
      content: [{ type: 'text', text }]
    };
  }

  /**
   * Handle orchestrator_list_tasks
   */
  handleListTasks(args: ListTasksArgs): ToolResponse {
    const filter = args.filter || 'all';
    const tasks = this.orchestrator.listTasks(filter);
    
    if (tasks.length === 0) {
      return {
        content: [{ type: 'text', text: 'No tasks found.' }]
      };
    }

    let text = `📋 Tasks (${filter})\n`;
    text += `──────────────────────\n\n`;
    
    for (const task of tasks.slice(0, 20)) {
      const statusIcon = task.status === 'completed' ? '✓' : 
                        task.status === 'failed' ? '✗' : 
                        task.status === 'in_progress' ? '▶' : '○';
      text += `${statusIcon} [${task.phase}] ${task.title}\n`;
      text += `   ${task.description.slice(0, 60)}${task.description.length > 60 ? '...' : ''}\n\n`;
    }

    if (tasks.length > 20) {
      text += `... and ${tasks.length - 20} more tasks\n`;
    }

    return {
      content: [{ type: 'text', text }]
    };
  }

  /**
   * Handle orchestrator_force_retry
   */
  async handleForceRetry(args: ForceRetryArgs): Promise<ToolResponse> {
    await this.orchestrator.forceRetry(args.taskId);
    return {
      content: [{
        type: 'text',
        text: `✓ Task ${args.taskId} moved back to pending queue.\nUse 'orchestrator_next_target' to work on it.`
      }]
    };
  }

  /**
   * Handle orchestrator_reset
   */
  async handleReset(args: ResetArgs): Promise<ToolResponse> {
    await this.orchestrator.reset(args.confirm);
    return {
      content: [{
        type: 'text',
        text: '✓ Orchestrator state has been reset.'
      }]
    };
  }

  /**
   * Handle orchestrator_create_checkpoint
   */
  async handleCreateCheckpoint(args: CheckpointArgs): Promise<ToolResponse> {
    const checkpointId = await this.orchestrator.createCheckpoint(args.name);
    return {
      content: [{
        type: 'text',
        text: `✓ Checkpoint created: ${checkpointId}`
      }]
    };
  }

  /**
   * Handle orchestrator_restore_checkpoint
   */
  async handleRestoreCheckpoint(args: RestoreCheckpointArgs): Promise<ToolResponse> {
    await this.orchestrator.restoreCheckpoint(args.checkpointId);
    return {
      content: [{
        type: 'text',
        text: `✓ State restored from checkpoint: ${args.checkpointId}`
      }]
    };
  }

  /**
   * Handle orchestrator_verify
   */
  async handleVerify(args: VerifyArgs): Promise<ToolResponse> {
    const result = await this.orchestrator.verifyProject(args.verbose);
    
    return {
      content: [{
        type: 'text',
        text: result.success
          ? `✓ Project verification passed!\n\n${result.output}`
          : `✗ Project verification failed.\n\n${result.output}`
      }],
      isError: !result.success
    };
  }
}
