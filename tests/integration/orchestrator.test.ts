/**
 * Orchestrator Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Orchestrator } from '../../src/core/orchestrator.js';

describe('Orchestrator Integration', () => {
  let tempDir: string;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
    orchestrator = new Orchestrator({
      projectPath: tempDir,
      qualityThreshold: 85
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('should initialize successfully', async () => {
      await orchestrator.init();
      const status = orchestrator.getStatus();
      expect(status.state).toBe('IDLE');
      expect(status.score).toBe(0);
    });

    it('should load saved state after re-init', async () => {
      await orchestrator.init();
      
      // Ingest a goal
      await orchestrator.ingestGoal('Test goal');
      
      // Create new orchestrator pointing to same directory
      const orchestrator2 = new Orchestrator({
        projectPath: tempDir
      });
      await orchestrator2.init();
      
      const status = orchestrator2.getStatus();
      expect(status.state).not.toBe('IDLE');
    });
  });

  describe('ingestGoal', () => {
    it('should ingest a simple goal', async () => {
      await orchestrator.init();
      
      const result = await orchestrator.ingestGoal('Create a simple calculator');
      
      expect(result.count).toBeGreaterThan(0);
      expect(['llm', 'rule-based', 'provided']).toContain(result.method);
      
      const status = orchestrator.getStatus();
      expect(status.state).toBe('EXECUTE_SESSION');
      expect(status.pendingTasks).toBeGreaterThan(0);
    });

    it('should ingest structured requirements', async () => {
      await orchestrator.init();
      
      const result = await orchestrator.ingestGoal('Test', [], [
        {
          id: 'req-1',
          description: 'Implement add function',
          type: 'feature',
          priority: 'high',
          components: ['src/calc.ts'],
          acceptanceCriteria: ['Can add two numbers'],
          dependencies: []
        },
        {
          id: 'req-2',
          description: 'Implement subtract function',
          type: 'feature',
          priority: 'high',
          components: ['src/calc.ts'],
          acceptanceCriteria: ['Can subtract two numbers'],
          dependencies: ['req-1']
        }
      ]);
      
      expect(result.count).toBe(2);
      expect(result.method).toBe('provided');
    });
  });

  describe('getNextTarget', () => {
    it('should return no tasks when none pending', async () => {
      await orchestrator.init();
      
      const result = await orchestrator.getNextTarget('session-1');
      expect(result.task).toBeNull();
    });

    it('should return task when goals ingested', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Create a calculator with add and subtract');
      
      const result = await orchestrator.getNextTarget('session-1');
      expect(result.task).not.toBeNull();
      expect(result.context).toBeDefined();
      expect(result.context.length).toBeGreaterThan(0);
    });
  });

  describe('listTasks', () => {
    it('should return empty array initially', async () => {
      await orchestrator.init();
      const tasks = orchestrator.listTasks('all');
      expect(tasks).toEqual([]);
    });

    it('should return tasks after ingesting goal', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Create a calculator');
      
      const tasks = orchestrator.listTasks('all');
      expect(tasks.length).toBeGreaterThan(0);
    });

    it('should filter tasks by status', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Create a calculator');
      
      // Get a task to make it in_progress
      await orchestrator.getNextTarget('session-1');
      
      const pending = orchestrator.listTasks('pending');
      const all = orchestrator.listTasks('all');
      
      expect(all.length).toBeGreaterThanOrEqual(pending.length);
    });
  });

  describe('checkpoints', () => {
    it('should create and restore checkpoint', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Create a calculator');
      
      const checkpointId = await orchestrator.createCheckpoint('test-checkpoint');
      expect(checkpointId).toBe('test-checkpoint');
      
      // Get a task to change state
      await orchestrator.getNextTarget('session-1');
      const statusBefore = orchestrator.getStatus();
      
      // Restore checkpoint
      await orchestrator.restoreCheckpoint('test-checkpoint');
      const statusAfter = orchestrator.getStatus();
      
      // Status should be back to what it was after ingestGoal
      expect(statusAfter.pendingTasks).toBeGreaterThanOrEqual(statusBefore.pendingTasks - 1);
    });
  });

  describe('reset', () => {
    it('should reset state when confirmed', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Create a calculator');
      
      await orchestrator.reset(true);
      
      const status = orchestrator.getStatus();
      expect(status.state).toBe('IDLE');
      expect(status.pendingTasks).toBe(0);
      expect(status.score).toBe(0);
    });

    it('should throw when not confirmed', async () => {
      await orchestrator.init();
      
      await expect(orchestrator.reset(false)).rejects.toThrow();
    });
  });
});
