/**
 * MCP Resources
 * Resource definitions for the orchestrator MCP server
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { Orchestrator } from '../core/orchestrator.js';

export function registerResources(server: McpServer, orchestrator: Orchestrator): void {
  // Resource: Current State
  server.registerResource(
    'orchestrator_state',
    'orchestrator://state',
    {
      title: 'Orchestrator State',
      description: 'Current orchestrator state including goal, progress, and task queue',
      mimeType: 'application/json'
    },
    async () => {
      const status = orchestrator.getStatus();
      const tasks = orchestrator.listTasks('all');

      return {
        contents: [{
          uri: 'orchestrator://state',
          text: JSON.stringify({
            status,
            tasks: tasks.map(t => ({
              id: t.id,
              phase: t.phase,
              title: t.title,
              status: t.status
            }))
          }, null, 2)
        }]
      };
    }
  );

  // Resource: Current Task
  server.registerResource(
    'orchestrator_current_task',
    'orchestrator://current-task',
    {
      title: 'Current Task',
      description: 'Full context for the currently active task',
      mimeType: 'application/json'
    },
    async () => {
      const status = orchestrator.getStatus();
      
      if (!status.currentTask) {
        return {
          contents: [{
            uri: 'orchestrator://current-task',
            text: JSON.stringify({ message: 'No active task' }, null, 2)
          }]
        };
      }

      return {
        contents: [{
          uri: 'orchestrator://current-task',
          text: JSON.stringify(status.currentTask, null, 2)
        }]
      };
    }
  );

  // Resource: Project Score
  server.registerResource(
    'orchestrator_score',
    'orchestrator://score',
    {
      title: 'Project Score',
      description: 'Current project score and breakdown',
      mimeType: 'application/json'
    },
    async () => {
      const score = orchestrator.getScore();

      return {
        contents: [{
          uri: 'orchestrator://score',
          text: JSON.stringify(score, null, 2)
        }]
      };
    }
  );

  // Resource: Task List
  server.registerResource(
    'orchestrator_task_list',
    'orchestrator://task-list',
    {
      title: 'Task List',
      description: 'All tasks in the current roadmap',
      mimeType: 'application/json'
    },
    async () => {
      const tasks = orchestrator.listTasks('all');

      return {
        contents: [{
          uri: 'orchestrator://task-list',
          text: JSON.stringify({
            total: tasks.length,
            tasks: tasks.map(t => ({
              id: t.id,
              phase: t.phase,
              title: t.title,
              status: t.status,
              attempts: t.attempts
            }))
          }, null, 2)
        }]
      };
    }
  );
}
