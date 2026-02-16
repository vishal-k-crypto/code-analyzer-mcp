/**
 * State Journal Module
 * Handles write-ahead logging for state persistence
 * 
 * This module provides journaling capabilities to ensure state durability
 * and crash recovery. Journal entries are written before state changes
 * to provide atomic state updates.
 */

import { promises as fs, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Journal entry types
 */
export type JournalOperation = 'write' | 'checkpoint' | 'restore';

/**
 * Journal entry structure
 */
export interface JournalEntry {
  timestamp: string;
  operation: JournalOperation;
  stateHash: string;
  previousHash?: string;
}

/**
 * Journal metadata for recovery
 */
export interface JournalMetadata {
  lastEntryTime: string;
  totalEntries: number;
  lastOperation: JournalOperation;
}

/**
 * State Journal for write-ahead logging
 */
export class StateJournal {
  private journalPath: string;

  constructor(basePath: string) {
    this.journalPath = join(basePath, 'state', 'journal');
    this.ensureDirectory();
  }

  /**
   * Ensure journal directory exists with secure permissions
   */
  private ensureDirectory(): void {
    if (!existsSync(this.journalPath)) {
      mkdirSync(this.journalPath, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Write a journal entry for state persistence
   */
  async writeEntry(
    stateHash: string, 
    operation: JournalOperation = 'write',
    previousHash?: string
  ): Promise<string> {
    const entry: JournalEntry = {
      timestamp: new Date().toISOString(),
      operation,
      stateHash,
      previousHash
    };

    const journalFile = join(this.journalPath, `${Date.now()}.json`);
    await fs.writeFile(journalFile, JSON.stringify(entry, null, 2), { mode: 0o600 });

    return journalFile;
  }

  /**
   * Write a checkpoint journal entry
   */
  async writeCheckpointEntry(_checkpointId: string, stateHash: string): Promise<string> {
    const entry: JournalEntry = {
      timestamp: new Date().toISOString(),
      operation: 'checkpoint',
      stateHash
    };

    const journalFile = join(this.journalPath, `checkpoint-${Date.now()}.json`);
    await fs.writeFile(journalFile, JSON.stringify(entry, null, 2), { mode: 0o600 });

    return journalFile;
  }

  /**
   * Write a restore journal entry
   */
  async writeRestoreEntry(_checkpointId: string, stateHash: string): Promise<string> {
    const entry: JournalEntry = {
      timestamp: new Date().toISOString(),
      operation: 'restore',
      stateHash
    };

    const journalFile = join(this.journalPath, `restore-${Date.now()}.json`);
    await fs.writeFile(journalFile, JSON.stringify(entry, null, 2), { mode: 0o600 });

    return journalFile;
  }

  /**
   * Read all journal entries sorted by timestamp (newest first)
   */
  async readEntries(): Promise<Array<{ file: string; entry: JournalEntry }>> {
    try {
      const files = await fs.readdir(this.journalPath);
      const journalFiles = files.filter(f => f.endsWith('.json'));

      const entries: Array<{ file: string; entry: JournalEntry }> = [];

      for (const file of journalFiles.sort().reverse()) {
        try {
          const content = await fs.readFile(join(this.journalPath, file), 'utf-8');
          const entry: JournalEntry = JSON.parse(content);
          entries.push({ file, entry });
        } catch {
          // Skip corrupted entries
          continue;
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Get journal metadata
   */
  async getMetadata(): Promise<JournalMetadata | null> {
    const entries = await this.readEntries();
    if (entries.length === 0) {
      return null;
    }

    const latest = entries[0];
    return {
      lastEntryTime: latest.entry.timestamp,
      totalEntries: entries.length,
      lastOperation: latest.entry.operation
    };
  }

  /**
   * Find the most recent journal entry with a matching state hash
   */
  async findEntryByHash(stateHash: string): Promise<JournalEntry | null> {
    const entries = await this.readEntries();
    
    for (const { entry } of entries) {
      if (entry.stateHash === stateHash) {
        return entry;
      }
    }

    return null;
  }

  /**
   * Cleanup old journal entries, keeping the most recent ones
   */
  async cleanup(maxEntries: number): Promise<number> {
    try {
      const files = await fs.readdir(this.journalPath);
      const journalFiles = files
        .filter(f => f.endsWith('.json'))
        .sort();

      if (journalFiles.length <= maxEntries) {
        return 0;
      }

      const toDelete = journalFiles.slice(0, journalFiles.length - maxEntries);
      let deletedCount = 0;

      for (const file of toDelete) {
        try {
          await fs.unlink(join(this.journalPath, file));
          deletedCount++;
        } catch {
          // Ignore individual delete errors
        }
      }

      return deletedCount;
    } catch {
      return 0;
    }
  }

  /**
   * Clear all journal entries (use with caution)
   */
  async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.journalPath);
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          await fs.unlink(join(this.journalPath, file));
        } catch {
          // Ignore individual delete errors
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Get the journal directory path
   */
  getPath(): string {
    return this.journalPath;
  }
}
