/**
 * Tests for State Persistence Module
 * Verifies atomic writes, state serialization, and recovery integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StatePersistence } from '../persistence.js';
import type { OrchestratorState } from '../../../types/state.js';

describe('StatePersistence', () => {
  let tempDir: string;
  let persistence: StatePersistence;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `orchestrator-persistence-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    persistence = new StatePersistence(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('directory structure', () => {
    it('should create required directories on initialization', async () => {
      const basePath = join(tempDir, '.orchestrator');
      
      // Check that directories are created
      const stateDir = await fs.stat(join(basePath, 'state')).catch(() => null);
      const journalDir = await fs.stat(join(basePath, 'state', 'journal')).catch(() => null);
      const snapshotsDir = await fs.stat(join(basePath, 'state', 'snapshots')).catch(() => null);
      const tasksCompletedDir = await fs.stat(join(basePath, 'tasks', 'completed')).catch(() => null);
      const tasksFailedDir = await fs.stat(join(basePath, 'tasks', 'failed')).catch(() => null);
      const errorsDir = await fs.stat(join(basePath, 'errors')).catch(() => null);
      const projectsDir = await fs.stat(join(basePath, 'projects')).catch(() => null);

      expect(stateDir?.isDirectory()).toBe(true);
      expect(journalDir?.isDirectory()).toBe(true);
      expect(snapshotsDir?.isDirectory()).toBe(true);
      expect(tasksCompletedDir?.isDirectory()).toBe(true);
      expect(tasksFailedDir?.isDirectory()).toBe(true);
      expect(errorsDir?.isDirectory()).toBe(true);
      expect(projectsDir?.isDirectory()).toBe(true);
    });
  });

  describe('persistState', () => {
    it('should persist state to disk atomically', async () => {
      const state = createMockState();
      
      await persistence.persistState(state);
      
      const statePath = join(tempDir, '.orchestrator', 'state', 'current.json');
      const content = await fs.readFile(statePath, 'utf-8');
      const persisted = JSON.parse(content);
      
      expect(persisted.projectPath).toBe(state.projectPath);
      expect(persisted.progress.currentState).toBe(state.progress.currentState);
      expect(persisted.progress.completionScore).toBe(state.progress.completionScore);
    });

    it('should create journal entries on persist', async () => {
      const state = createMockState();
      
      await persistence.persistState(state);
      
      const journal = persistence.getJournal();
      const entries = await journal.readEntries();
      
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].entry.operation).toBe('write');
      expect(entries[0].entry.stateHash).toBeDefined();
    });

    it('should handle multiple sequential persists', async () => {
      const state1 = createMockState({ completionScore: 10 });
      const state2 = createMockState({ completionScore: 20 });
      
      await persistence.persistState(state1);
      await persistence.persistState(state2);
      
      const loaded = await persistence.loadState();
      expect(loaded.progress.completionScore).toBe(20);
    });
  });

  describe('loadState', () => {
    it('should load persisted state', async () => {
      const state = createMockState();
      await persistence.persistState(state);
      
      const loaded = await persistence.loadState();
      
      expect(loaded.projectPath).toBe(state.projectPath);
      expect(loaded.progress.currentState).toBe(state.progress.currentState);
    });

    it('should return default state when no state exists', async () => {
      const loaded = await persistence.loadState();
      
      expect(loaded.progress.currentState).toBe('IDLE');
      expect(loaded.projectGoal).toBeNull();
      expect(loaded.taskQueue.pending).toEqual([]);
    });

    it('should revive Date objects on load', async () => {
      const state = createMockState();
      const now = new Date();
      state.progress.lastVerifiedAt = now;
      
      await persistence.persistState(state);
      const loaded = await persistence.loadState();
      
      expect(loaded.progress.lastVerifiedAt).toBeInstanceOf(Date);
      expect(loaded.progress.lastVerifiedAt?.getTime()).toBe(now.getTime());
    });

    it('should revive Map objects on load', async () => {
      const state = createMockState();
      state.taskQueue.dependencies = new Map([['task1', ['task2']]]);
      state.errorLog.retryCount = new Map([['task1', 2]]);
      
      await persistence.persistState(state);
      const loaded = await persistence.loadState();
      
      expect(loaded.taskQueue.dependencies).toBeInstanceOf(Map);
      expect(loaded.taskQueue.dependencies.get('task1')).toEqual(['task2']);
      expect(loaded.errorLog.retryCount.get('task1')).toBe(2);
    });
  });

  describe('checkpoints', () => {
    it('should create named checkpoint', async () => {
      const state = createMockState();
      await persistence.persistState(state);
      
      const checkpointId = await persistence.createCheckpoint('test-checkpoint');
      
      expect(checkpointId).toBe('test-checkpoint');
      
      const checkpointPath = join(tempDir, '.orchestrator', 'state', 'snapshots', 'test-checkpoint.json');
      const exists = await fs.stat(checkpointPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create checkpoint with auto-generated name', async () => {
      const state = createMockState();
      await persistence.persistState(state);
      
      const checkpointId = await persistence.createCheckpoint();
      
      expect(checkpointId).toMatch(/^checkpoint-\d+$/);
    });

    it('should restore from checkpoint', async () => {
      const state = createMockState({ completionScore: 42 });
      await persistence.persistState(state);
      await persistence.createCheckpoint('restore-test');
      
      // Modify state
      const newState = createMockState({ completionScore: 10 });
      await persistence.persistState(newState);
      
      // Restore
      const restored = await persistence.restoreCheckpoint('restore-test');
      expect(restored.progress.completionScore).toBe(42);
    });

    it('should throw when restoring non-existent checkpoint', async () => {
      await expect(persistence.restoreCheckpoint('non-existent')).rejects.toThrow('Checkpoint not found');
    });

    it('should list available checkpoints', async () => {
      const state = createMockState();
      await persistence.persistState(state);
      
      await persistence.createCheckpoint('checkpoint-1');
      await persistence.createCheckpoint('checkpoint-2');
      
      const checkpoints = await persistence.listCheckpoints();
      
      expect(checkpoints).toContain('checkpoint-1');
      expect(checkpoints).toContain('checkpoint-2');
    });
  });

  describe('journal integration', () => {
    it('should provide access to journal', () => {
      const journal = persistence.getJournal();
      expect(journal).toBeDefined();
      expect(typeof journal.writeEntry).toBe('function');
    });

    it('should provide access to recovery', () => {
      const recovery = persistence.getRecovery();
      expect(recovery).toBeDefined();
      expect(typeof recovery.recover).toBe('function');
    });
  });

  describe('per-project state isolation', () => {
    it('should save project goal as markdown', async () => {
      const state = createMockState();
      state.projectGoal = {
        id: 'goal-1',
        description: 'Test goal',
        requirements: [{
          id: 'req1',
          description: 'Feature A',
          type: 'feature',
          priority: 'high',
          components: [],
          acceptanceCriteria: ['Works'],
          dependencies: [],
          weight: 1,
          verified: false,
          partiallyMet: false
        }],
        constraints: [],
        targetMetrics: {
          qualityThreshold: 85,
          maxIterations: 10,
          timeoutMinutes: 60
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await persistence.saveProjectGoal(state);

      const goalPath = join(tempDir, '.orchestrator', 'projects', 'default', 'goal.md');
      const content = await fs.readFile(goalPath, 'utf-8');
      expect(content).toContain('# Project Goal');
      expect(content).toContain('Test goal');
      expect(content).toContain('Feature A');
    });

    it('should load project goal markdown', async () => {
      const state = createMockState();
      state.projectGoal = {
        id: 'goal-1',
        description: 'Test goal',
        requirements: [],
        constraints: [],
        targetMetrics: {
          qualityThreshold: 85,
          maxIterations: 10,
          timeoutMinutes: 60
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await persistence.saveProjectGoal(state);
      const loaded = await persistence.loadProjectGoal();

      expect(loaded).toContain('Test goal');
    });

    it('should save gaps analysis', async () => {
      const gaps = [
        { id: 'gap1', description: 'Missing feature', severity: 'high' as const, category: 'feature' },
        { id: 'gap2', description: 'No tests', severity: 'medium' as const, category: 'test' }
      ];

      await persistence.saveGapsAnalysis(gaps);

      const gapsPath = join(tempDir, '.orchestrator', 'projects', 'default', 'gaps.json');
      const content = await fs.readFile(gapsPath, 'utf-8');
      const saved = JSON.parse(content);
      expect(saved.gaps).toHaveLength(2);
      expect(saved.gaps[0].id).toBe('gap1');
    });

    it('should load gaps analysis', async () => {
      const gaps = [{ id: 'gap1', description: 'Test', severity: 'high' as const, category: 'feature' }];
      await persistence.saveGapsAnalysis(gaps);

      const loaded = await persistence.loadGapsAnalysis();
      expect(loaded).not.toBeNull();
      expect((loaded as any).gaps[0].id).toBe('gap1');
    });

    it('should save score history', async () => {
      const history = {
        entries: [
          { timestamp: new Date().toISOString(), score: 50, breakdown: { tests: 50 } },
          { timestamp: new Date().toISOString(), score: 75, breakdown: { tests: 75 } }
        ],
        trend: 'improving' as const,
        velocity: 25
      };

      await persistence.saveScoreHistory(history);

      const historyPath = join(tempDir, '.orchestrator', 'projects', 'default', 'score-history.json');
      const content = await fs.readFile(historyPath, 'utf-8');
      const saved = JSON.parse(content);
      expect(saved.entries).toHaveLength(2);
      expect(saved.trend).toBe('improving');
    });

    it('should load score history', async () => {
      const history = {
        entries: [{ timestamp: new Date().toISOString(), score: 50, breakdown: {} }],
        trend: 'stable' as const,
        velocity: 0
      };
      await persistence.saveScoreHistory(history);

      const loaded = await persistence.loadScoreHistory();
      expect(loaded).not.toBeNull();
    });

    it('should list projects', async () => {
      // Create project-specific persistence
      const persistence1 = new StatePersistence(tempDir, 'project-1');
      const persistence2 = new StatePersistence(tempDir, 'project-2');

      const state = createMockState();
      state.projectGoal = {
        id: 'goal-1',
        description: 'Project 1',
        requirements: [],
        constraints: [],
        targetMetrics: { qualityThreshold: 85, maxIterations: 10, timeoutMinutes: 60 },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await persistence1.saveProjectGoal(state);
      await persistence2.saveProjectGoal(state);

      const projects = await persistence.listProjects();
      expect(projects).toContain('project-1');
      expect(projects).toContain('project-2');
    });
  });

  // Helper function to create mock state
  function createMockState(overrides: Partial<OrchestratorState['progress']> = {}): OrchestratorState {
    return {
      projectGoal: null,
      progress: {
        currentState: 'ANALYZE_GAPS',
        completedTasks: [],
        currentTask: null,
        completionScore: overrides.completionScore ?? 0,
        lastVerifiedAt: null
      },
      taskQueue: {
        phases: [],
        pending: [],
        inProgress: null,
        failed: [],
        dependencies: new Map()
      },
      errorLog: {
        entries: [],
        patterns: [],
        retryCount: new Map()
      },
      projectPath: tempDir
    };
  }
});
