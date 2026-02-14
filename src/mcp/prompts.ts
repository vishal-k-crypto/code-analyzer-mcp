/**
 * MCP Prompts
 * Prompt definitions for the orchestrator MCP server
 */

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Orchestrator } from '../core/orchestrator.js';
import { generateNextTargetGuide } from '../subsystems/context-injector/templates.js';

export function registerPrompts(server: McpServer, orchestrator: Orchestrator): void {
  // Prompt: Next Target Guide
  server.registerPrompt(
    'orchestrator_next_target_guide',
    {
      title: 'Next Target Guide',
      description: 'Guide the user on how to request and work on the next target'
    },
    async (): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> }> => {
      const status = orchestrator.getStatus();
      const pendingTasks = status.pendingTasks;

      const guide = generateNextTargetGuide(
        status.state,
        status.score > 0 || pendingTasks > 0,
        pendingTasks
      );

      return {
        messages: [{
          role: 'assistant',
          content: {
            type: 'text',
            text: guide
          }
        }]
      };
    }
  );

  // Prompt: Project Overview
  server.registerPrompt(
    'orchestrator_project_overview',
    {
      title: 'Project Overview',
      description: 'Get an overview of the current project state'
    },
    async (): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> }> => {
      const status = orchestrator.getStatus();
      const score = orchestrator.getScore();

      let text = '# Project Overview\n\n';
      text += `## Status\n`;
      text += `- Current State: ${status.state}\n`;
      text += `- Completion Score: ${score.score}/100\n`;
      text += `- Quality Threshold: 85\n\n`;

      text += `## Tasks\n`;
      text += `- Pending: ${status.pendingTasks}\n`;
      text += `- Completed: ${status.completedTasks}\n`;
      text += `- Failed: ${status.failedTasks}\n\n`;

      if (status.currentTask) {
        text += `## Current Task\n`;
        text += `- Title: ${status.currentTask.title}\n`;
        text += `- Phase: ${status.currentTask.phase}\n`;
        text += `- Attempts: ${status.currentTask.attempts}\n\n`;
      }

      text += `## Next Steps\n`;
      if (status.pendingTasks > 0) {
        text += `1. Call 'orchestrator_next_target' to get the next task\n`;
        text += `2. Review the bounded context provided\n`;
        text += `3. Implement the task within the specified boundaries\n`;
        text += `4. Submit results with 'orchestrator_submit_result'\n`;
      } else if (status.state === 'COMPLETE') {
        text += `🎉 Project complete! Score: ${score.score}/100\n`;
      } else {
        text += `No pending tasks. Check status or ingest a new goal.\n`;
      }

      return {
        messages: [{
          role: 'assistant',
          content: {
            type: 'text',
            text
          }
        }]
      };
    }
  );
}
