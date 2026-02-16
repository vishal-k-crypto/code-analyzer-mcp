/**
 * MCP Resources
 * Resource definitions for the orchestrator MCP server
 */

import { type Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { Orchestrator } from '../core/orchestrator.js';

// Resource definitions
const RESOURCES = [
  {
    uri: 'orchestrator://state',
    name: 'Orchestrator State',
    description: 'Current orchestrator state including goal, progress, and task queue',
    mimeType: 'application/json'
  },
  {
    uri: 'orchestrator://current-task',
    name: 'Current Task',
    description: 'Full context for the currently active task',
    mimeType: 'application/json'
  },
  {
    uri: 'orchestrator://score',
    name: 'Project Score',
    description: 'Current project score and breakdown',
    mimeType: 'application/json'
  },
  {
    uri: 'orchestrator://task-list',
    name: 'Task List',
    description: 'All tasks in the current roadmap',
    mimeType: 'application/json'
  },
  {
    uri: 'orchestrator://errors',
    name: 'Error Log',
    description: 'Error history and patterns from failed tasks',
    mimeType: 'application/json'
  },
  {
    uri: 'orchestrator://task-history',
    name: 'Task History',
    description: 'Historical record of all task executions with timing and results',
    mimeType: 'application/json'
  }
];

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'orchestrator://task/{taskId}',
    name: 'Task Details',
    description: 'Details for a specific task by ID',
    mimeType: 'application/json'
  }
];

export function registerResources(server: Server, orchestrator: Orchestrator): void {
  // ListResources handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: RESOURCES };
  });

  // ListResourceTemplates handler
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return { resourceTemplates: RESOURCE_TEMPLATES };
  });

  // ReadResource handler
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'orchestrator://state') {
      const status = orchestrator.getStatus();
      const tasks = orchestrator.listTasks('all');

      return {
        contents: [{
          uri: 'orchestrator://state',
          mimeType: 'application/json',
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

    if (uri === 'orchestrator://current-task') {
      const status = orchestrator.getStatus();
      
      if (!status.currentTask) {
        return {
          contents: [{
            uri: 'orchestrator://current-task',
            mimeType: 'application/json',
            text: JSON.stringify({ message: 'No active task' }, null, 2)
          }]
        };
      }

      return {
        contents: [{
          uri: 'orchestrator://current-task',
          mimeType: 'application/json',
          text: JSON.stringify(status.currentTask, null, 2)
        }]
      };
    }

    if (uri === 'orchestrator://score') {
      const score = orchestrator.getScore();

      return {
        contents: [{
          uri: 'orchestrator://score',
          mimeType: 'application/json',
          text: JSON.stringify(score, null, 2)
        }]
      };
    }

    if (uri === 'orchestrator://task-list') {
      const tasks = orchestrator.listTasks('all');

      return {
        contents: [{
          uri: 'orchestrator://task-list',
          mimeType: 'application/json',
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

    if (uri === 'orchestrator://errors') {
      // Get error information from orchestrator state
      const status = orchestrator.getStatus();
      
      return {
        contents: [{
          uri: 'orchestrator://errors',
          mimeType: 'application/json',
          text: JSON.stringify({
            message: 'Error log resource - errors are tracked in state',
            currentState: status.state,
            failedTasks: status.failedTasks,
            note: 'Use orchestrator_list_tasks with filter="failed" to see detailed error information'
          }, null, 2)
        }]
      };
    }

    if (uri === 'orchestrator://task-history') {
      const tasks = orchestrator.listTasks('all');
      const completedTasks = tasks.filter(t => t.status === 'completed');
      const failedTasks = tasks.filter(t => t.status === 'failed');

      return {
        contents: [{
          uri: 'orchestrator://task-history',
          mimeType: 'application/json',
          text: JSON.stringify({
            summary: {
              total: tasks.length,
              completed: completedTasks.length,
              failed: failedTasks.length
            },
            completedTasks: completedTasks.map(t => ({
              id: t.id,
              title: t.title,
              phase: t.phase,
              completedAt: t.completedAt
            })),
            failedTasks: failedTasks.map(t => ({
              id: t.id,
              title: t.title,
              phase: t.phase,
              attempts: t.attempts
            }))
          }, null, 2)
        }]
      };
    }

    // Handle task template URIs
    const taskMatch = uri.match(/^orchestrator:\/\/task\/(.+)$/);
    if (taskMatch) {
      const taskId = taskMatch[1];
      const tasks = orchestrator.listTasks('all');
      const task = tasks.find(t => t.id === taskId);

      if (task) {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(task, null, 2)
          }]
        };
      }
    }

    throw new Error(`Resource not found: ${uri}`);
  });
}
