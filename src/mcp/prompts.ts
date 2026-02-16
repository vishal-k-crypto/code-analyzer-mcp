/**
 * MCP Prompts
 * Prompt definitions for the orchestrator MCP server
 */

import { type Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { Orchestrator } from '../core/orchestrator.js';
import { generateNextTargetGuide } from '../subsystems/context-injector/templates.js';

// Prompt definitions
const PROMPTS = [
  {
    name: 'orchestrator_next_target_guide',
    description: 'Guide the user on how to request and work on the next target',
    arguments: []
  },
  {
    name: 'orchestrator_project_overview',
    description: 'Get an overview of the current project state',
    arguments: []
  },
  {
    name: 'orchestrator_bounded_context',
    description: 'Get the bounded context for the current task including allowed and forbidden files',
    arguments: []
  },
  {
    name: 'orchestrator_error_context',
    description: 'Get error context and guidance for failed tasks',
    arguments: [
      {
        name: 'taskId',
        description: 'ID of the failed task to get error context for',
        required: false
      }
    ]
  }
];

export function registerPrompts(server: Server, orchestrator: Orchestrator): void {
  // ListPrompts handler
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: PROMPTS };
  });

  // GetPrompt handler
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'orchestrator_next_target_guide': {
        const status = orchestrator.getStatus();
        const pendingTasks = status.pendingTasks;

        const guide = generateNextTargetGuide(
          status.state,
          status.score > 0 || pendingTasks > 0,
          pendingTasks
        );

        return {
          description: 'Next Target Guide',
          messages: [{
            role: 'assistant',
            content: {
              type: 'text',
              text: guide
            }
          }]
        };
      }

      case 'orchestrator_project_overview': {
        const status = orchestrator.getStatus();
        const score = orchestrator.getScore();

        let text = '# Project Overview\n\n';
        text += '## Status\n';
        text += `- Current State: ${status.state}\n`;
        text += `- Completion Score: ${score.score}/100\n`;
        text += `- Quality Threshold: 85\n\n`;

        text += '## Tasks\n';
        text += `- Pending: ${status.pendingTasks}\n`;
        text += `- Completed: ${status.completedTasks}\n`;
        text += `- Failed: ${status.failedTasks}\n\n`;

        if (status.currentTask) {
          text += '## Current Task\n';
          text += `- Title: ${status.currentTask.title}\n`;
          text += `- Phase: ${status.currentTask.phase}\n`;
          text += `- Attempts: ${status.currentTask.attempts}\n\n`;
        }

        text += '## Next Steps\n';
        if (status.pendingTasks > 0) {
          text += "1. Call 'orchestrator_next_target' to get the next task\n";
          text += '2. Review the bounded context provided\n';
          text += '3. Implement the task within the specified boundaries\n';
          text += "4. Submit results with 'orchestrator_submit_result'\n";
        } else if (status.state === 'COMPLETE') {
          text += `🎉 Project complete! Score: ${score.score}/100\n`;
        } else {
          text += 'No pending tasks. Check status or ingest a new goal.\n';
        }

        return {
          description: 'Project Overview',
          messages: [{
            role: 'assistant',
            content: {
              type: 'text',
              text
            }
          }]
        };
      }

      case 'orchestrator_bounded_context': {
        const status = orchestrator.getStatus();
        
        if (!status.currentTask) {
          return {
            description: 'Bounded Context',
            messages: [{
              role: 'assistant',
              content: {
                type: 'text',
                text: '# Bounded Context\n\nNo active task. Use `orchestrator_next_target` to get a task with its bounded context.'
              }
            }]
          };
        }

        const task = status.currentTask;
        let text = `# Bounded Context for Task: ${task.title}\n\n`;
        
        text += `## Task Description\n${task.description}\n\n`;
        text += `## Phase: ${task.phase}\n\n`;
        
        if (task.context) {
          if (task.context.essentialFiles && task.context.essentialFiles.length > 0) {
            text += `## Essential Files (${task.context.essentialFiles.length})\n`;
            for (const file of task.context.essentialFiles.slice(0, 20)) {
              text += `- ${file.path} (relevance: ${(file.relevance * 100).toFixed(0)}%)\n`;
            }
            if (task.context.essentialFiles.length > 20) {
              text += `- ... and ${task.context.essentialFiles.length - 20} more\n`;
            }
            text += '\n';
          }

          if (task.context.referenceFiles && task.context.referenceFiles.length > 0) {
            text += `## Reference Files (${task.context.referenceFiles.length})\n`;
            for (const file of task.context.referenceFiles.slice(0, 10)) {
              text += `- ${file.path} (relevance: ${(file.relevance * 100).toFixed(0)}%)\n`;
            }
            if (task.context.referenceFiles.length > 10) {
              text += `- ... and ${task.context.referenceFiles.length - 10} more\n`;
            }
            text += '\n';
          }

          if (task.context.forbiddenFiles && task.context.forbiddenFiles.length > 0) {
            text += '## ⚠️ Forbidden Files (DO NOT MODIFY)\n';
            for (const file of task.context.forbiddenFiles.slice(0, 20)) {
              text += `- ${file}\n`;
            }
            if (task.context.forbiddenFiles.length > 20) {
              text += `- ... and ${task.context.forbiddenFiles.length - 20} more\n`;
            }
            text += '\n';
          }

          if (task.context.testCommands && task.context.testCommands.length > 0) {
            text += '## Verification Commands\n';
            for (const cmd of task.context.testCommands) {
              text += `- \`${cmd}\`\n`;
            }
            text += '\n';
          }
        }

        return {
          description: 'Bounded Context',
          messages: [{
            role: 'assistant',
            content: {
              type: 'text',
              text
            }
          }]
        };
      }

      case 'orchestrator_error_context': {
        const status = orchestrator.getStatus();
        const taskId = args?.taskId as string | undefined;
        
        let text = '# Error Context\n\n';
        
        if (taskId) {
          const tasks = orchestrator.listTasks('all');
          const task = tasks.find(t => t.id === taskId);
          
          if (task && task.status === 'failed') {
            text += `## Failed Task: ${task.title}\n`;
            text += `- Task ID: ${task.id}\n`;
            text += `- Attempts: ${task.attempts}\n`;
            text += `- Phase: ${task.phase}\n\n`;
            text += '## Recommendations\n';
            text += '1. Review the task description and acceptance criteria\n';
            text += '2. Check the bounded context for relevant files\n';
            text += '3. Run verification commands to understand the failure\n';
            text += "4. Use 'orchestrator_force_retry' with error details to retry\n";
          } else if (task) {
            text += `Task ${taskId} is not in failed status (current: ${task.status}).\n`;
          } else {
            text += `Task ${taskId} not found.\n`;
          }
        } else {
          const failedCount = status.failedTasks;
          
          if (failedCount === 0) {
            text += 'No failed tasks currently. All tasks are passing or pending.\n';
          } else {
            text += `There are ${failedCount} failed task(s).\n\n`;
            text += '## How to Retry\n';
            text += '1. List failed tasks: `orchestrator_list_tasks(filter: "failed")`\n';
            text += '2. Get error context with a specific taskId\n';
            text += '3. Fix the issues and use `orchestrator_force_retry` to retry\n';
          }
        }

        return {
          description: 'Error Context',
          messages: [{
            role: 'assistant',
            content: {
              type: 'text',
              text
            }
          }]
        };
      }

      default:
        throw new Error(`Prompt not found: ${name}`);
    }
  });
}
