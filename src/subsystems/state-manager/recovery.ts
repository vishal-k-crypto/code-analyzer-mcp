/**
 * State Recovery Module
 * Handles crash recovery from journal entries and checkpoints
 * 
 * This module provides recovery mechanisms to restore state after crashes
 * by analyzing journal entries and available checkpoints.
 */

import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import type { OrchestratorState } from '../../types/state.js';
import type { StateJournal } from './journal.js';

/**
 * Recovery result type
 */
export interface RecoveryResult {
  success: boolean;
  state: OrchestratorState | null;
  source: 'journal' | 'checkpoint' | 'statefile' | null;
  entryTimestamp?: string;
  errors: string[];
}

/**
 * Checkpoint info
 */
export interface CheckpointInfo {
  id: string;
  timestamp: string;
  stateHash: string;
  path: string;
}

/**
 * State Recovery manager
 */
export class StateRecovery {
  private statePath: string;
  private snapshotsPath: string;
  private journal: StateJournal;

  constructor(
    statePath: string, 
    snapshotsPath: string,
    journal: StateJournal
  ) {
    this.statePath = statePath;
    this.snapshotsPath = snapshotsPath;
    this.journal = journal;
  }

  /**
   * Attempt recovery from journal and checkpoints
   */
  async recover(): Promise<RecoveryResult> {
    const errors: string[] = [];

    // Strategy 1: Try to recover from current state file if valid
    try {
      if (existsSync(this.statePath)) {
        const content = await fs.readFile(this.statePath, 'utf-8');
        const state = this.deserializeState(content);
        
        // Validate the state structure
        if (this.validateState(state)) {
          // Verify hash matches latest journal entry if available
          const stateHash = this.computeHash(content);
          const matchingEntry = await this.journal.findEntryByHash(stateHash);
          
          if (matchingEntry) {
            return {
              success: true,
              state,
              source: 'journal',
              entryTimestamp: matchingEntry.timestamp,
              errors
            };
          }

          // State file is valid even without matching journal
          return {
            success: true,
            state,
            source: 'statefile',
            errors
          };
        } else {
          errors.push('Current state file has invalid structure');
        }
      }
    } catch (error) {
      errors.push(`Failed to read current state: ${error}`);
    }

    // Strategy 2: Try to recover from journal entries
    try {
      const journalRecovery = await this.recoverFromJournal();
      if (journalRecovery.success && journalRecovery.state) {
        return {
          success: true,
          state: journalRecovery.state,
          source: 'journal',
          entryTimestamp: journalRecovery.entryTimestamp,
          errors
        };
      }
    } catch (error) {
      errors.push(`Journal recovery failed: ${error}`);
    }

    // Strategy 3: Try to recover from latest checkpoint
    try {
      const checkpointRecovery = await this.recoverFromLatestCheckpoint();
      if (checkpointRecovery.success && checkpointRecovery.state) {
        return {
          success: true,
          state: checkpointRecovery.state,
          source: 'checkpoint',
          entryTimestamp: checkpointRecovery.entryTimestamp,
          errors
        };
      }
    } catch (error) {
      errors.push(`Checkpoint recovery failed: ${error}`);
    }

    // All recovery strategies failed
    return {
      success: false,
      state: null,
      source: null,
      errors
    };
  }

  /**
   * Recover from journal entries by finding the most recent valid write/checkpoint entry
   */
  private async recoverFromJournal(): Promise<Partial<RecoveryResult>> {
    const entries = await this.journal.readEntries();

    for (const { entry } of entries) {
      // Only consider write and checkpoint operations for recovery
      if (entry.operation !== 'write' && entry.operation !== 'checkpoint') {
        continue;
      }

      // Try to find a state file that matches this journal entry
      if (existsSync(this.statePath)) {
        try {
          const content = await fs.readFile(this.statePath, 'utf-8');
          const stateHash = this.computeHash(content);

          if (stateHash === entry.stateHash) {
            const state = this.deserializeState(content);
            if (this.validateState(state)) {
              return {
                success: true,
                state,
                entryTimestamp: entry.timestamp
              };
            }
          }
        } catch {
          // Continue to next entry
          continue;
        }
      }

      // Check for matching checkpoint
      const checkpoints = await this.listCheckpoints();
      for (const checkpoint of checkpoints) {
        try {
          const content = await fs.readFile(checkpoint.path, 'utf-8');
          const stateHash = this.computeHash(content);

          if (stateHash === entry.stateHash) {
            const state = this.deserializeState(content);
            if (this.validateState(state)) {
              return {
                success: true,
                state,
                entryTimestamp: entry.timestamp
              };
            }
          }
        } catch {
          continue;
        }
      }
    }

    return { success: false, state: null };
  }

  /**
   * Recover from the most recent checkpoint
   */
  private async recoverFromLatestCheckpoint(): Promise<Partial<RecoveryResult>> {
    const checkpoints = await this.listCheckpoints();

    if (checkpoints.length === 0) {
      return { success: false, state: null };
    }

    // Sort by timestamp (newest first)
    checkpoints.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    for (const checkpoint of checkpoints) {
      try {
        const content = await fs.readFile(checkpoint.path, 'utf-8');
        const state = this.deserializeState(content);

        if (this.validateState(state)) {
          return {
            success: true,
            state,
            entryTimestamp: checkpoint.timestamp
          };
        }
      } catch {
        continue;
      }
    }

    return { success: false, state: null };
  }

  /**
   * List all available checkpoints
   */
  async listCheckpoints(): Promise<CheckpointInfo[]> {
    try {
      if (!existsSync(this.snapshotsPath)) {
        return [];
      }

      const files = await fs.readdir(this.snapshotsPath);
      const checkpoints: CheckpointInfo[] = [];

      for (const file of files.filter(f => f.endsWith('.json'))) {
        const path = join(this.snapshotsPath, file);
        try {
          const content = await fs.readFile(path, 'utf-8');
          const state = this.deserializeState(content);
          const stateHash = this.computeHash(content);

          checkpoints.push({
            id: file.replace('.json', ''),
            timestamp: state.progress?.lastVerifiedAt?.toISOString() || new Date().toISOString(),
            stateHash,
            path
          });
        } catch {
          // Skip corrupted checkpoints
          continue;
        }
      }

      return checkpoints;
    } catch {
      return [];
    }
  }

  /**
   * Get the most recent checkpoint info
   */
  async getLatestCheckpoint(): Promise<CheckpointInfo | null> {
    const checkpoints = await this.listCheckpoints();
    if (checkpoints.length === 0) {
      return null;
    }

    checkpoints.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return checkpoints[0];
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
   * Deserialize state from JSON with Date and Map revival
   */
  private deserializeState(content: string): OrchestratorState {
    const parsed = JSON.parse(content, (_key, value) => {
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
}

/**
 * Create a default empty state for initialization
 */
export function createDefaultState(): OrchestratorState {
  return {
    projectGoal: null,
    progress: {
      currentState: 'IDLE' as const,
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
