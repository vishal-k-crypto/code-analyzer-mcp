/**
 * MCP Tools
 * Tool definitions for the orchestrator MCP server
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { Orchestrator } from '../core/orchestrator.js';
import type { ParsedRequirement } from '../types/gap.js';

// Type definitions for tool parameters
type IngestGoalParams = {
  goal: string;
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
};

type NextTargetParams = {
  sessionId: string;
};

type SubmitResultParams = {
  taskId: string;
  files: Array<{ path: string; content: string }>;
  notes?: string;
};

type GetScoreParams = {
  includeHistory?: boolean;
};

type ListTasksParams = {
  filter?: 'pending' | 'completed' | 'failed' | 'all';
};

type ForceRetryParams = {
  taskId: string;
  error?: string;
};

type ResetParams = {
  confirm: boolean;
};

type CreateCheckpointParams = {
  name?: string;
};

type RestoreCheckpointParams = {
  checkpointId: string;
};

export function registerTools(server: McpServer, orchestrator: Orchestrator): void {
  // Tool: Ingest Goal
  server.registerTool(
    'orchestrator_ingest_goal',
    {
      title: 'Ingest Project Goal',
      description: `Ingest a new project goal and initialize the orchestration loop.
      
The goal can be provided as:
1. A natural language description (parsed using LLM if API key is available, otherwise rule-based)
2. Pre-structured requirements (bypasses parsing entirely)

Environment Variables for LLM Support:
- OPENAI_API_KEY: Use OpenAI for requirement parsing
- ANTHROPIC_API_KEY: Use Anthropic for requirement parsing  
- LLM_API_KEY + LLM_BASE_URL: Use custom OpenAI-compatible API

If no API key is set, the tool will use rule-based parsing which may be less accurate for complex goals.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          goal: { type: 'string', description: 'Master project goal description (natural language)' },
          projectPath: { type: 'string', description: 'Path to project directory (optional if already set)' },
          constraints: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Additional constraints' 
          },
          structuredRequirements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Optional requirement ID' },
                description: { type: 'string', description: 'Requirement description' },
                type: { 
                  type: 'string', 
                  enum: ['feature', 'bugfix', 'refactor', 'test'],
                  description: 'Requirement type' 
                },
                priority: { 
                  type: 'string', 
                  enum: ['critical', 'high', 'medium', 'low'],
                  description: 'Requirement priority' 
                },
                components: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'Related components/files' 
                },
                acceptanceCriteria: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'Acceptance criteria' 
                },
                dependencies: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'IDs of dependent requirements' 
                }
              },
              required: ['description', 'type', 'priority']
            },
            description: 'Pre-structured requirements (bypasses LLM/rule-based parsing)'
          }
        },
        required: ['goal']
      }
    },
    async (params: IngestGoalParams): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const { goal, constraints, structuredRequirements } = params;
        
        // Transform structured requirements to ParsedRequirement format if provided
        let parsedRequirements: ParsedRequirement[] | undefined;
        
        if (structuredRequirements && structuredRequirements.length > 0) {
          parsedRequirements = structuredRequirements.map((req, index) => ({
            id: req.id || `REQ-${index + 1}`,
            description: req.description,
            type: req.type,
            priority: req.priority,
            components: req.components || [],
            acceptanceCriteria: req.acceptanceCriteria || [],
            dependencies: req.dependencies || []
          }));
        }

        const result = await orchestrator.ingestGoal(goal, constraints || [], parsedRequirements);
        
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
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `✗ Failed to ingest goal: ${error}`
          }]
        };
      }
    }
  );

  // Tool: Get Next Target
  server.registerTool(
    'orchestrator_next_target',
    {
      title: 'Get Next Target',
      description: 'Get the next atomic task to execute in an isolated session',
      inputSchema: {
        type: 'object' as const,
        properties: {
          sessionId: { type: 'string', description: 'Unique session identifier' }
        },
        required: ['sessionId']
      }
    },
    async (params: NextTargetParams): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const { task, context } = await orchestrator.getNextTarget(params.sessionId);
        
        if (!task) {
          return {
            content: [{
              type: 'text',
              text: context
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: context
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `✗ Failed to get next target: ${error}`
          }]
        };
      }
    }
  );

  // Tool: Submit Result
  server.registerTool(
    'orchestrator_submit_result',
    {
      title: 'Submit Task Result',
      description: 'Submit the result of executing a task',
      inputSchema: {
        type: 'object' as const,
        properties: {
          taskId: { type: 'string', description: 'ID of the completed task' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['path', 'content']
            },
            description: 'Modified or created files'
          },
          notes: { type: 'string', description: 'Additional notes' }
        },
        required: ['taskId', 'files']
      }
    },
    async (params: SubmitResultParams): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const result = await orchestrator.submitResult(params.taskId, params.files, params.notes);
        
        return {
          content: [{
            type: 'text',
            text: result.success 
              ? `✓ Task completed successfully!\n\n${result.verificationResults}\n\nUse 'orchestrator_next_target' to continue.`
              : `✗ Task verification failed.\n\n${result.verificationResults}\n\nPlease fix the issues and try again.`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `✗ Failed to submit result: ${error}`
          }]
        };
      }
    }
  );

  // Tool: Get Status
  server.registerTool(
    'orchestrator_status',
    {
      title: 'Get Project Status',
      description: 'Get current project status and score',
      inputSchema: {
        type: 'object' as const,
        properties: {}
      }
    },
    async (): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const status = orchestrator.getStatus();
      
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
  );

  // Tool: Get Score
  server.registerTool(
    'orchestrator_get_score',
    {
      title: 'Get Project Score',
      description: 'Get detailed project score breakdown',
      inputSchema: {
        type: 'object' as const,
        properties: {
          includeHistory: { 
            type: 'boolean', 
            description: 'Include score history' 
          }
        }
      }
    },
    async (_params: GetScoreParams): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const { score, breakdown } = orchestrator.getScore();
      
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
  );

  // Tool: List Tasks
  server.registerTool(
    'orchestrator_list_tasks',
    {
      title: 'List Tasks',
      description: 'List all tasks in the current roadmap',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filter: { 
            type: 'string', 
            enum: ['pending', 'completed', 'failed', 'all'],
            description: 'Filter tasks by status' 
          }
        }
      }
    },
    async (params: ListTasksParams): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const filter = params.filter || 'all';
      const tasks = orchestrator.listTasks(filter);
      
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
  );

  // Tool: Force Retry
  server.registerTool(
    'orchestrator_force_retry',
    {
      title: 'Force Retry Task',
      description: 'Force retry of a failed task with error context',
      inputSchema: {
        type: 'object' as const,
        properties: {
          taskId: { type: 'string', description: 'ID of the failed task to retry' },
          error: { type: 'string', description: 'Error message to include in context' }
        },
        required: ['taskId']
      }
    },
    async (params: ForceRetryParams): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        await orchestrator.forceRetry(params.taskId);
        return {
          content: [{
            type: 'text',
            text: `✓ Task ${params.taskId} moved back to pending queue.\nUse 'orchestrator_next_target' to work on it.`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `✗ Failed to retry task: ${error}`
          }]
        };
      }
    }
  );

  // Tool: Reset
  server.registerTool(
    'orchestrator_reset',
    {
      title: 'Reset Orchestrator',
      description: 'Reset orchestrator state (use with caution)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          confirm: { 
            type: 'boolean', 
            description: 'Must be true to confirm reset' 
          }
        },
        required: ['confirm']
      }
    },
    async (params: ResetParams): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        await orchestrator.reset(params.confirm);
        return {
          content: [{
            type: 'text',
            text: '✓ Orchestrator state has been reset.'
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `✗ Failed to reset: ${error}`
          }]
        };
      }
    }
  );

  // Tool: Create Checkpoint
  server.registerTool(
    'orchestrator_create_checkpoint',
    {
      title: 'Create Checkpoint',
      description: 'Create a named checkpoint for rollback',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Checkpoint name' }
        }
      }
    },
    async (params: CreateCheckpointParams): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const checkpointId = await orchestrator.createCheckpoint(params.name);
        return {
          content: [{
            type: 'text',
            text: `✓ Checkpoint created: ${checkpointId}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `✗ Failed to create checkpoint: ${error}`
          }]
        };
      }
    }
  );

  // Tool: Restore Checkpoint
  server.registerTool(
    'orchestrator_restore_checkpoint',
    {
      title: 'Restore Checkpoint',
      description: 'Restore state from a checkpoint',
      inputSchema: {
        type: 'object' as const,
        properties: {
          checkpointId: { type: 'string', description: 'Checkpoint ID to restore' }
        },
        required: ['checkpointId']
      }
    },
    async (params: RestoreCheckpointParams): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        await orchestrator.restoreCheckpoint(params.checkpointId);
        return {
          content: [{
            type: 'text',
            text: `✓ State restored from checkpoint: ${params.checkpointId}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `✗ Failed to restore checkpoint: ${error}`
          }]
        };
      }
    }
  );
}
