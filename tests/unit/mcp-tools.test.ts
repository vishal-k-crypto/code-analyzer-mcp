/**
 * MCP Tools Unit Tests
 * Tests for all 10 MCP tool handlers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { ToolHandlers } from '../../src/mcp/handlers.js';

describe('MCP Tools', () => {
  let tempDir: string;
  let orchestrator: Orchestrator;
  let handlers: ToolHandlers;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-tools-test-'));
    orchestrator = new Orchestrator({
      projectPath: tempDir,
      qualityThreshold: 85
    });
    handlers = new ToolHandlers(orchestrator);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('orchestrator_ingest_goal', () => {
    it('should ingest a simple goal', async () => {
      await orchestrator.init();

      const result = await handlers.handleIngestGoal({
        goal: 'Create a simple calculator'
      });

      expect(result.content[0].text).toContain('Goal ingested successfully');
      expect(result.content[0].text).toContain('Requirements Extracted');
      expect(result.isError).toBeUndefined();
    });

    it('should ingest with structured requirements', async () => {
      await orchestrator.init();

      const result = await handlers.handleIngestGoal({
        goal: 'Test project',
        structuredRequirements: [
          {
            id: 'req-1',
            description: 'Feature A',
            type: 'feature',
            priority: 'critical',
            components: ['a.ts'],
            acceptanceCriteria: ['Works'],
            dependencies: []
          },
          {
            id: 'req-2',
            description: 'Feature B',
            type: 'feature',
            priority: 'high',
            components: ['b.ts'],
            acceptanceCriteria: ['Works'],
            dependencies: ['req-1']
          }
        ]
      });

      expect(result.content[0].text).toContain('provided');
      expect(result.content[0].text).toContain('2');
    });

    it('should ingest with constraints', async () => {
      await orchestrator.init();

      const result = await handlers.handleIngestGoal({
        goal: 'Test project',
        constraints: ['Use TypeScript', 'No external dependencies']
      });

      expect(result.content[0].text).toContain('Goal ingested successfully');
    });
  });

  describe('orchestrator_next_target', () => {
    it('should return task when available', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test project', [], [
        { id: 'r1', description: 'Task 1', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] }
      ]);

      const result = await handlers.handleNextTarget({ sessionId: 'session-1' });

      expect(result.content[0].text.length).toBeGreaterThan(0);
      expect(result.content[0].text).toContain('BOUNDED CONTEXT');
    });

    it('should handle no tasks available', async () => {
      await orchestrator.init();

      const result = await handlers.handleNextTarget({ sessionId: 'session-1' });

      // Should return a message indicating no tasks
      expect(result.content[0].text).toBeDefined();
    });

    it('should use unique session IDs', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test project', [], [
        { id: 'r1', description: 'Task 1', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] }
      ]);

      // First session
      const result1 = await handlers.handleNextTarget({ sessionId: 'session-1' });
      expect(result1.content[0].text).toContain('BOUNDED CONTEXT');

      // Same session trying to get another task should return the same task
      const result2 = await handlers.handleNextTarget({ sessionId: 'session-1' });
      expect(result2.content[0].text).toBeDefined();
    });
  });

  describe('orchestrator_submit_result', () => {
    it('should submit task result with files', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test project', [], [
        { id: 'r1', description: 'Create file', type: 'feature', priority: 'critical', components: ['test.ts'], acceptanceCriteria: ['File created'], dependencies: [] }
      ]);

      const targetResult = await orchestrator.getNextTarget('session-1');
      const taskId = targetResult.task!.id;

      const result = await handlers.handleSubmitResult({
        taskId,
        files: [
          { path: 'test.ts', content: 'export const x = 1;' }
        ],
        notes: 'Implemented feature'
      });

      expect(result.content[0].text).toBeDefined();
    });

    it('should handle submission with multiple files', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test project', [], [
        { id: 'r1', description: 'Create files', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] }
      ]);

      const targetResult = await orchestrator.getNextTarget('session-1');
      const taskId = targetResult.task!.id;

      const result = await handlers.handleSubmitResult({
        taskId,
        files: [
          { path: 'a.ts', content: 'export const a = 1;' },
          { path: 'b.ts', content: 'export const b = 2;' },
          { path: 'c.ts', content: 'export const c = 3;' }
        ]
      });

      expect(result.content[0].text).toBeDefined();
    });

    it('should handle invalid task ID', async () => {
      await orchestrator.init();

      await expect(handlers.handleSubmitResult({
        taskId: 'invalid-task-id',
        files: [{ path: 'test.ts', content: '' }]
      })).rejects.toThrow();
    });
  });

  describe('orchestrator_status', () => {
    it('should return status with all fields', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test project', [], [
        { id: 'r1', description: 'Task 1', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] },
        { id: 'r2', description: 'Task 2', type: 'feature', priority: 'high', components: [], acceptanceCriteria: [], dependencies: [] }
      ]);

      const result = handlers.handleStatus();

      expect(result.content[0].text).toContain('Project Status');
      expect(result.content[0].text).toContain('State:');
      expect(result.content[0].text).toContain('Score:');
      expect(result.content[0].text).toContain('Pending:');
      expect(result.content[0].text).toContain('Completed:');
      expect(result.content[0].text).toContain('Failed:');
    });

    it('should show idle status initially', async () => {
      await orchestrator.init();

      const result = handlers.handleStatus();

      expect(result.content[0].text).toContain('IDLE');
      expect(result.content[0].text).toContain('0/100');
    });
  });

  describe('orchestrator_get_score', () => {
    it('should return score with breakdown', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test project');

      const result = handlers.handleGetScore({ includeHistory: false });

      expect(result.content[0].text).toContain('Project Score:');
      expect(result.content[0].text).toContain('Breakdown:');
      expect(result.content[0].text).toContain('Requirements Coverage:');
      expect(result.content[0].text).toContain('Test Pass Rate:');
      expect(result.content[0].text).toContain('Code Quality:');
      expect(result.content[0].text).toContain('Implementation:');
    });

    it('should show penalties if any', async () => {
      await orchestrator.init();

      // Create state with penalties
      await orchestrator.ingestGoal('Test');

      const result = handlers.handleGetScore({});

      // Score output should be present
      expect(result.content[0].text).toContain('Project Score:');
    });
  });

  describe('orchestrator_list_tasks', () => {
    beforeEach(async () => {
      await orchestrator.init();
    });

    it('should return empty when no tasks', () => {
      const result = handlers.handleListTasks({ filter: 'all' });

      expect(result.content[0].text).toContain('No tasks found');
    });

    it('should list all tasks', async () => {
      await orchestrator.ingestGoal('Test project', [], [
        { id: 'r1', description: 'Task 1 description', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] },
        { id: 'r2', description: 'Task 2 description', type: 'feature', priority: 'high', components: [], acceptanceCriteria: [], dependencies: [] }
      ]);

      const result = handlers.handleListTasks({ filter: 'all' });

      expect(result.content[0].text).toContain('Tasks (all)');
      expect(result.content[0].text).toContain('Task 1');
      expect(result.content[0].text).toContain('Task 2');
    });

    it('should filter by pending', async () => {
      await orchestrator.ingestGoal('Test project', [], [
        { id: 'r1', description: 'Pending task', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] }
      ]);

      const result = handlers.handleListTasks({ filter: 'pending' });

      expect(result.content[0].text).toContain('pending');
    });

    it('should filter by completed', async () => {
      const result = handlers.handleListTasks({ filter: 'completed' });

      expect(result.content[0].text).toContain('completed');
    });

    it('should limit display to 20 tasks', async () => {
      // Create many requirements to generate many tasks
      const requirements = Array.from({ length: 25 }, (_, i) => ({
        id: `r${i}`,
        description: `Task ${i} description that is fairly long`,
        type: 'feature' as const,
        priority: 'medium' as const,
        components: [],
        acceptanceCriteria: [],
        dependencies: []
      }));

      await orchestrator.ingestGoal('Big project', [], requirements);

      const result = handlers.handleListTasks({ filter: 'all' });

      expect(result.content[0].text).toContain('... and');
      expect(result.content[0].text).toContain('more tasks');
    });
  });

  describe('orchestrator_force_retry', () => {
    it('should retry a failed task', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test project', [], [
        { id: 'r1', description: 'Task 1', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] }
      ]);

      const targetResult = await orchestrator.getNextTarget('session-1');
      const taskId = targetResult.task!.id;

      // Force the task to fail by retrying it
      const result = await handlers.handleForceRetry({ taskId });

      expect(result.content[0].text).toContain('moved back to pending queue');
      expect(result.content[0].text).toContain(taskId);
    });

    it('should throw for invalid task ID', async () => {
      await orchestrator.init();

      await expect(handlers.handleForceRetry({ taskId: 'invalid-id' })).rejects.toThrow();
    });
  });

  describe('orchestrator_reset', () => {
    it('should reset state when confirmed', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test project');

      const result = await handlers.handleReset({ confirm: true });

      expect(result.content[0].text).toContain('state has been reset');

      const status = orchestrator.getStatus();
      expect(status.state).toBe('IDLE');
    });

    it('should throw when not confirmed', async () => {
      await orchestrator.init();

      await expect(handlers.handleReset({ confirm: false })).rejects.toThrow();
    });
  });

  describe('orchestrator_create_checkpoint', () => {
    it('should create named checkpoint', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test project');

      const result = await handlers.handleCreateCheckpoint({ name: 'my-checkpoint' });

      expect(result.content[0].text).toContain('Checkpoint created');
      expect(result.content[0].text).toContain('my-checkpoint');
    });

    it('should create checkpoint with auto-generated name', async () => {
      await orchestrator.init();

      const result = await handlers.handleCreateCheckpoint({});

      expect(result.content[0].text).toContain('Checkpoint created');
    });
  });

  describe('orchestrator_restore_checkpoint', () => {
    it('should restore from checkpoint', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test project');
      await orchestrator.createCheckpoint('restore-point');

      const result = await handlers.handleRestoreCheckpoint({ checkpointId: 'restore-point' });

      expect(result.content[0].text).toContain('State restored');
      expect(result.content[0].text).toContain('restore-point');
    });

    it('should throw for non-existent checkpoint', async () => {
      await orchestrator.init();

      await expect(handlers.handleRestoreCheckpoint({ checkpointId: 'non-existent' }))
        .rejects.toThrow();
    });
  });
});
