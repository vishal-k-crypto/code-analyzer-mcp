/**
 * State Persistence Module
 * Handles file-based state persistence with atomic writes and journaling
 */

import { promises as fs, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import stableStringify from 'fast-json-stable-stringify';
import type { OrchestratorState, State, Task, ErrorEntry } from '../../types/state.js';

export interface JournalEntry {
  timestamp: string;
  operation: 'write' | 'checkpoint' | 'restore';
  stateHash: string;
  previousHash?: string;
}

export class StatePersistence {
  private basePath: string;
  private statePath: string;
  private journalPath: string;
  private snapshotsPath: string;
  private currentState: OrchestratorState | null = null;

  constructor(projectPath: string) {
    this.basePath = join(projectPath, '.orchestrator');
    this.statePath = join(this.basePath, 'state', 'current.json');
    this.journalPath = join(this.basePath, 'state', 'journal');
    this.snapshotsPath = join(this.basePath, 'state', 'snapshots');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.basePath,
      join(this.basePath, 'state'),
      this.journalPath,
      this.snapshotsPath,
      join(this.basePath, 'tasks', 'completed'),
      join(this.basePath, 'tasks', 'failed'),
      join(this.basePath, 'errors'),
      join(this.basePath, 'projects')
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
    }
  }

  /**
   * Persist state atomically with journaling
   */
  async persistState(state: OrchestratorState): Promise<void> {
    const serialized = this.serializeState(state);
    const stateHash = this.computeHash(serialized);
    const previousHash = this.currentState 
      ? this.computeHash(this.serializeState(this.currentState))
      : undefined;

    // Write to journal first (write-ahead logging)
    const journalEntry: JournalEntry = {
      timestamp: new Date().toISOString(),
      operation: 'write',
      stateHash,
      previousHash
    };

    const journalFile = join(this.journalPath, `${Date.now()}.json`);
    await fs.writeFile(journalFile, JSON.stringify(journalEntry, null, 2), { mode: 0o600 });

    // Write state to temporary file
    const tempPath = `${this.statePath}.tmp`;
    await fs.writeFile(tempPath, serialized, { mode: 0o600 });

    // Atomic rename
    await fs.rename(tempPath, this.statePath);

    // Update current state
    this.currentState = structuredClone(state);

    // Cleanup old journal entries (keep last 50)
    await this.cleanupOldJournals(50);
  }

  /**
   * Load state from disk or return default
   */
  async loadState(): Promise<OrchestratorState> {
    try {
      if (!existsSync(this.statePath)) {
        return this.createDefaultState();
      }

      const content = await fs.readFile(this.statePath, 'utf-8');
      const state = this.deserializeState(content);
      
      // Validate loaded state
      if (!this.validateState(state)) {
        console.warn('Invalid state loaded, attempting recovery...');
        return await this.recoverFromJournal() || this.createDefaultState();
      }

      this.currentState = structuredClone(state);
      return state;
    } catch (error) {
      console.error('Failed to load state:', error);
      return await this.recoverFromJournal() || this.createDefaultState();
    }
  }

  /**
   * Create a named checkpoint
   */
  async createCheckpoint(name?: string): Promise<string> {
    if (!this.currentState) {
      throw new Error('No state to checkpoint');
    }

    const checkpointId = name || `checkpoint-${Date.now()}`;
    const checkpointPath = join(this.snapshotsPath, `${checkpointId}.json`);
    
    const serialized = this.serializeState(this.currentState);
    await fs.writeFile(checkpointPath, serialized, { mode: 0o600 });

    // Journal the checkpoint
    const journalEntry: JournalEntry = {
      timestamp: new Date().toISOString(),
      operation: 'checkpoint',
      stateHash: this.computeHash(serialized)
    };

    const journalFile = join(this.journalPath, `checkpoint-${Date.now()}.json`);
    await fs.writeFile(journalFile, JSON.stringify(journalEntry, null, 2), { mode: 0o600 });

    return checkpointId;
  }

  /**
   * Restore from checkpoint
   */
  async restoreCheckpoint(checkpointId: string): Promise<OrchestratorState> {
    const checkpointPath = join(this.snapshotsPath, `${checkpointId}.json`);
    
    if (!existsSync(checkpointPath)) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const content = await fs.readFile(checkpointPath, 'utf-8');
    const state = this.deserializeState(content);

    // Journal the restore
    const journalEntry: JournalEntry = {
      timestamp: new Date().toISOString(),
      operation: 'restore',
      stateHash: this.computeHash(content)
    };

    const journalFile = join(this.journalPath, `restore-${Date.now()}.json`);
    await fs.writeFile(journalFile, JSON.stringify(journalEntry, null, 2), { mode: 0o600 });

    this.currentState = structuredClone(state);
    return state;
  }

  /**
   * List available checkpoints
   */
  async listCheckpoints(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.snapshotsPath);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * Attempt recovery from journal
   */
  private async recoverFromJournal(): Promise<OrchestratorState | null> {
    try {
      const files = await fs.readdir(this.journalPath);
      const journalFiles = files
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();

      for (const file of journalFiles) {
        const content = await fs.readFile(join(this.journalPath, file), 'utf-8');
        const entry: JournalEntry = JSON.parse(content);

        if (entry.operation === 'write' || entry.operation === 'checkpoint') {
          // Try to find matching checkpoint or current state
          const checkpointPath = join(this.snapshotsPath, `checkpoint-${entry.timestamp.split('T')[0]}*.json`);
          // If we have a valid current state, use it
          if (existsSync(this.statePath)) {
            const stateContent = await fs.readFile(this.statePath, 'utf-8');
            if (this.computeHash(stateContent) === entry.stateHash) {
              return this.deserializeState(stateContent);
            }
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Serialize state to JSON string
   */
  private serializeState(state: OrchestratorState): string {
    return stableStringify(state, { space: 2 });
  }

  /**
   * Deserialize state from JSON string
   */
  private deserializeState(content: string): OrchestratorState {
    const parsed = JSON.parse(content, (key, value) => {
      // Revive Date objects
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        return new Date(value);
      }
      // Revive Maps
      if (value && typeof value === 'object' && value.__type === 'Map') {
        return new Map(value.data);
      }
      return value;
    });

    // Convert dependencies Map if stored as plain object
    if (parsed.taskQueue?.dependencies && !(parsed.taskQueue.dependencies instanceof Map)) {
      parsed.taskQueue.dependencies = new Map(Object.entries(parsed.taskQueue.dependencies));
    }

    // Convert errorLog retryCount Map if stored as plain object
    if (parsed.errorLog?.retryCount && !(parsed.errorLog.retryCount instanceof Map)) {
      parsed.errorLog.retryCount = new Map(Object.entries(parsed.errorLog.retryCount));
    }

    return parsed;
  }

  /**
   * Validate state structure
   */
  private validateState(state: unknown): state is OrchestratorState {
    if (!state || typeof state !== 'object') return false;
    const s = state as Partial<OrchestratorState>;
    
    return (
      'progress' in s &&
      'taskQueue' in s &&
      'errorLog' in s &&
      'projectPath' in s &&
      typeof s.projectPath === 'string'
    );
  }

  /**
   * Create default empty state
   */
  private createDefaultState(): OrchestratorState {
    return {
      projectGoal: null,
      progress: {
        currentState: 'IDLE' as State,
        completedTasks: [],
        currentTask: null,
        completionScore: 0,
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
      projectPath: ''
    };
  }

  /**
   * Compute simple hash for state validation
   */
  private computeHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Cleanup old journal entries
   */
  private async cleanupOldJournals(maxEntries: number): Promise<void> {
    try {
      const files = await fs.readdir(this.journalPath);
      const journalFiles = files
        .filter(f => f.endsWith('.json'))
        .sort();

      if (journalFiles.length > maxEntries) {
        const toDelete = journalFiles.slice(0, journalFiles.length - maxEntries);
        for (const file of toDelete) {
          await fs.unlink(join(this.journalPath, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
