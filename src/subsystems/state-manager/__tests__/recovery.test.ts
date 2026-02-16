/**
 * Tests for State Recovery Module
 * Verifies crash recovery from journal and checkpoints
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StateRecovery, createDefaultState } from '../recovery.js';
import { StateJournal } from '../journal.js';
import type { OrchestratorState } from '../../../types/state.js';

describe('StateRecovery', () => {
  let tempDir: string;
  let basePath: string;
  let statePath: string;
  let snapshotsPath: string;
  let journal: StateJournal;
  let recovery: StateRecovery;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `orchestrator-recovery-test-${Date.now()}`);
    basePath = join(tempDir, '.orchestrator');
    statePath = join(basePath, 'state', 'current.json');
    snapshotsPath = join(basePath, 'state', 'snapshots');
    
    await fs.mkdir(basePath, { recursive: true });
    await fs.mkdir(join(basePath, 'state'), { recursive: true });
    await fs.mkdir(snapshotsPath, { recursive: true });
    
    journal = new StateJournal(basePath);
    recovery = new StateRecovery(statePath, snapshotsPath, journal);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createDefaultState', () => {
    it('should create valid default state', () => {
      const state = createDefaultState();

      expect(state.progress.currentState).toBe('IDLE');
      expect(state.projectGoal).toBeNull();
      expect(state.taskQueue.pending).toEqual([]);
      expect(state.taskQueue.dependencies).toBeInstanceOf(Map);
      expect(state.errorLog.retryCount).toBeInstanceOf(Map);
      expect(state.projectPath).toBe('');
    });
  });

  describe('recover with no state', () => {
    it('should fail recovery when no state exists', async () => {
      const result = await recovery.recover();

      expect(result.success).toBe(false);
      expect(result.state).toBeNull();
      expect(result.source).toBeNull();
      // No errors are logged when no state exists (all strategies silently fail)
    });
  });

  describe('recover from state file', () => {
    it('should recover from valid state file', async () => {
      const state = createMockState({ completionScore: 75 });
      await saveState(state);

      const result = await recovery.recover();

      expect(result.success).toBe(true);
      expect(result.state?.progress.completionScore).toBe(75);
      expect(result.source).toBe('statefile');
    });

    it('should recover from state file with matching journal entry', async () => {
      const state = createMockState();
      // Save state with proper Map serialization
      const serializedWithMap = JSON.stringify(state, (_key, value) => {
        if (value instanceof Map) {
          return { __type: 'Map', data: Array.from(value.entries()) };
        }
        return value;
      });
      await fs.writeFile(statePath, serializedWithMap);

      // Create matching journal entry
      const hash = computeHash(serializedWithMap);
      await journal.writeEntry(hash, 'write');

      const result = await recovery.recover();

      expect(result.success).toBe(true);
      // Source is 'journal' when hash matches
      expect(result.source).toBe('journal');
    });
  });

  describe('recover from checkpoints', () => {
    it('should recover from checkpoint', async () => {
      const state = createMockState({ completionScore: 50 });
      const checkpointPath = join(snapshotsPath, 'backup.json');
      await fs.writeFile(checkpointPath, JSON.stringify(state, null, 2));

      const result = await recovery.recover();

      expect(result.success).toBe(true);
      expect(result.state?.progress.completionScore).toBe(50);
      expect(result.source).toBe('checkpoint');
    });

    it('should recover from most recent valid checkpoint', async () => {
      const oldState = createMockState({ completionScore: 10 });
      const newState = createMockState({ completionScore: 90 });
      const now = new Date();
      const older = new Date(now.getTime() - 10000);

      // Create older checkpoint with timestamp in the past
      oldState.progress.lastVerifiedAt = older;
      const oldPath = join(snapshotsPath, 'old.json');
      await fs.writeFile(oldPath, JSON.stringify(oldState, null, 2));
      await new Promise(r => setTimeout(r, 50));

      // Create newer checkpoint with current timestamp
      newState.progress.lastVerifiedAt = now;
      const newPath = join(snapshotsPath, 'new.json');
      await fs.writeFile(newPath, JSON.stringify(newState, null, 2));

      const result = await recovery.recover();

      expect(result.success).toBe(true);
      // Should recover the newer checkpoint (score 90)
      expect(result.state?.progress.completionScore).toBe(90);
    });

    it('should skip corrupted checkpoints', async () => {
      const validState = createMockState({ completionScore: 60 });

      // Create corrupted checkpoint
      const corruptedPath = join(snapshotsPath, 'corrupted.json');
      await fs.writeFile(corruptedPath, 'not valid json');

      // Create valid checkpoint
      const validPath = join(snapshotsPath, 'valid.json');
      await fs.writeFile(validPath, JSON.stringify(validState, null, 2));

      const result = await recovery.recover();

      expect(result.success).toBe(true);
      expect(result.state?.progress.completionScore).toBe(60);
    });
  });

  describe('listCheckpoints', () => {
    it('should return empty array when no checkpoints', async () => {
      const checkpoints = await recovery.listCheckpoints();
      expect(checkpoints).toEqual([]);
    });

    it('should list all checkpoints', async () => {
      const state = createMockState();
      state.progress.lastVerifiedAt = new Date();

      await fs.writeFile(
        join(snapshotsPath, 'checkpoint-a.json'),
        JSON.stringify(state, null, 2)
      );
      await fs.writeFile(
        join(snapshotsPath, 'checkpoint-b.json'),
        JSON.stringify(state, null, 2)
      );

      const checkpoints = await recovery.listCheckpoints();

      expect(checkpoints.length).toBe(2);
      expect(checkpoints.map(c => c.id)).toContain('checkpoint-a');
      expect(checkpoints.map(c => c.id)).toContain('checkpoint-b');
    });

    it('should include state hash in checkpoint info', async () => {
      const state = createMockState();
      const content = JSON.stringify(state, null, 2);
      
      await fs.writeFile(join(snapshotsPath, 'test.json'), content);

      const checkpoints = await recovery.listCheckpoints();

      expect(checkpoints[0].stateHash).toBeDefined();
      expect(checkpoints[0].timestamp).toBeDefined();
      expect(checkpoints[0].path).toContain('test.json');
    });
  });

  describe('getLatestCheckpoint', () => {
    it('should return null when no checkpoints', async () => {
      const latest = await recovery.getLatestCheckpoint();
      expect(latest).toBeNull();
    });

    it('should return most recent checkpoint', async () => {
      const now = new Date();
      const older = new Date(now.getTime() - 10000);

      const state1 = createMockState();
      state1.progress.lastVerifiedAt = older;
      await fs.writeFile(join(snapshotsPath, 'older.json'), JSON.stringify(state1, null, 2));

      const state2 = createMockState();
      state2.progress.lastVerifiedAt = now;
      await fs.writeFile(join(snapshotsPath, 'newer.json'), JSON.stringify(state2, null, 2));

      const latest = await recovery.getLatestCheckpoint();

      expect(latest?.id).toBe('newer');
    });
  });

  describe('state validation', () => {
    it('should reject invalid state structure', async () => {
      const invalidState = { projectPath: tempDir }; // Missing required fields
      await fs.writeFile(statePath, JSON.stringify(invalidState));

      const result = await recovery.recover();

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.includes('invalid'))).toBe(true);
    });

    it('should reject non-object state', async () => {
      await fs.writeFile(statePath, '"not an object"');

      const result = await recovery.recover();

      expect(result.success).toBe(false);
    });
  });

  describe('Map revival', () => {
    it('should revive Maps in recovered state', async () => {
      const state = createMockState();
      state.taskQueue.dependencies = new Map([['task1', ['task2', 'task3']]]);
      state.errorLog.retryCount = new Map([['task1', 3], ['task2', 1]]);
      
      // Save with proper Map serialization
      const serialized = JSON.stringify(state, (_key, value) => {
        if (value instanceof Map) {
          return { __type: 'Map', data: Array.from(value.entries()) };
        }
        return value;
      });
      await fs.writeFile(statePath, serialized);

      const result = await recovery.recover();

      expect(result.success).toBe(true);
      expect(result.state?.taskQueue.dependencies).toBeInstanceOf(Map);
      expect(result.state?.taskQueue.dependencies.get('task1')).toEqual(['task2', 'task3']);
      expect(result.state?.errorLog.retryCount.get('task1')).toBe(3);
    });
  });

  // Helper functions
  async function saveState(state: OrchestratorState): Promise<void> {
    const dir = join(statePath, '..');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  }

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

  function computeHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
});
