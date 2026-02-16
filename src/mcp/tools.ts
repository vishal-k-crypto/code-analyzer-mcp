/**
 * MCP Tools
 * Tool definitions for the orchestrator MCP server
 */

import { type Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { Orchestrator } from '../core/orchestrator.js';
import { ToolHandlers } from './handlers.js';

// Tool definitions
const TOOLS = [
  {
    name: 'orchestrator_ingest_goal',
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
  {
    name: 'orchestrator_next_target',
    description: 'Get the next atomic task to execute in an isolated session',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string', description: 'Unique session identifier' }
      },
      required: ['sessionId']
    }
  },
  {
    name: 'orchestrator_submit_result',
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
  {
    name: 'orchestrator_status',
    description: 'Get current project status and score',
    inputSchema: {
      type: 'object' as const,
      properties: {}
    }
  },
  {
    name: 'orchestrator_get_score',
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
  {
    name: 'orchestrator_list_tasks',
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
  {
    name: 'orchestrator_force_retry',
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
  {
    name: 'orchestrator_reset',
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
  {
    name: 'orchestrator_create_checkpoint',
    description: 'Create a named checkpoint for rollback',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Checkpoint name' }
      }
    }
  },
  {
    name: 'orchestrator_restore_checkpoint',
    description: 'Restore state from a checkpoint',
    inputSchema: {
      type: 'object' as const,
      properties: {
        checkpointId: { type: 'string', description: 'Checkpoint ID to restore' }
      },
      required: ['checkpointId']
    }
  },
  {
    name: 'orchestrator_verify',
    description: 'Run verification on the current project without submitting a task result. Runs tsc --noEmit, npm test, and eslint to check project health.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        verbose: {
          type: 'boolean',
          description: 'Include detailed output from all verification commands'
        }
      }
    }
  }
];

export function registerTools(server: Server, orchestrator: Orchestrator): void {
  const handlers = new ToolHandlers(orchestrator);

  // ListTools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // CallTool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'orchestrator_ingest_goal':
          return await handlers.handleIngestGoal(args as {
            goal: string;
            projectPath?: string;
            constraints?: string[];
            structuredRequirements?: any[];
          });

        case 'orchestrator_next_target':
          return await handlers.handleNextTarget(args as { sessionId: string });

        case 'orchestrator_submit_result':
          return await handlers.handleSubmitResult(args as {
            taskId: string;
            files: Array<{ path: string; content: string }>;
            notes?: string;
          });

        case 'orchestrator_status':
          return handlers.handleStatus();

        case 'orchestrator_get_score':
          return handlers.handleGetScore(args as { includeHistory?: boolean });

        case 'orchestrator_list_tasks':
          return handlers.handleListTasks(args as { filter?: 'pending' | 'completed' | 'failed' | 'all' });

        case 'orchestrator_force_retry':
          return await handlers.handleForceRetry(args as { taskId: string; error?: string });

        case 'orchestrator_reset':
          return await handlers.handleReset(args as { confirm: boolean });

        case 'orchestrator_create_checkpoint':
          return await handlers.handleCreateCheckpoint(args as { name?: string });

        case 'orchestrator_restore_checkpoint':
          return await handlers.handleRestoreCheckpoint(args as { checkpointId: string });

        case 'orchestrator_verify':
          return await handlers.handleVerify(args as { verbose?: boolean });

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });
}

export { TOOLS };
