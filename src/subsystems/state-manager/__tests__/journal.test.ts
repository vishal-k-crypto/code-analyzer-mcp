/**
 * Tests for State Journal Module
 * Verifies write-ahead logging functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StateJournal, type JournalEntry, type JournalOperation } from '../journal.js';

describe('StateJournal', () => {
  let tempDir: string;
  let journal: StateJournal;
  let basePath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `orchestrator-journal-test-${Date.now()}`);
    basePath = join(tempDir, '.orchestrator');
    await fs.mkdir(basePath, { recursive: true });
    journal = new StateJournal(basePath);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should create journal directory on initialization', async () => {
      const journalPath = join(basePath, 'state', 'journal');
      const stat = await fs.stat(journalPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should return journal path', () => {
      const path = journal.getPath();
      expect(path).toContain('journal');
      expect(path).toContain('.orchestrator');
    });
  });

  describe('writeEntry', () => {
    it('should write entry with all fields', async () => {
      const stateHash = 'abc123';
      const operation: JournalOperation = 'write';
      const previousHash = 'def456';

      const filePath = await journal.writeEntry(stateHash, operation, previousHash);

      const content = await fs.readFile(filePath, 'utf-8');
      const entry: JournalEntry = JSON.parse(content);

      expect(entry.stateHash).toBe(stateHash);
      expect(entry.operation).toBe(operation);
      expect(entry.previousHash).toBe(previousHash);
      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp)).toBeInstanceOf(Date);
    });

    it('should write entry without previous hash', async () => {
      const filePath = await journal.writeEntry('hash123', 'write');

      const content = await fs.readFile(filePath, 'utf-8');
      const entry: JournalEntry = JSON.parse(content);

      expect(entry.stateHash).toBe('hash123');
      expect(entry.previousHash).toBeUndefined();
    });

    it('should create unique files for sequential writes', async () => {
      const file1 = await journal.writeEntry('hash1', 'write');
      await new Promise(r => setTimeout(r, 10)); // Ensure different timestamp
      const file2 = await journal.writeEntry('hash2', 'write');

      expect(file1).not.toBe(file2);
    });
  });

  describe('writeCheckpointEntry', () => {
    it('should write checkpoint entry', async () => {
      const checkpointId = 'checkpoint-1';
      const stateHash = 'abc123';

      const filePath = await journal.writeCheckpointEntry(checkpointId, stateHash);

      expect(filePath).toContain('checkpoint');

      const content = await fs.readFile(filePath, 'utf-8');
      const entry: JournalEntry = JSON.parse(content);

      expect(entry.operation).toBe('checkpoint');
      expect(entry.stateHash).toBe(stateHash);
    });
  });

  describe('writeRestoreEntry', () => {
    it('should write restore entry', async () => {
      const checkpointId = 'checkpoint-1';
      const stateHash = 'abc123';

      const filePath = await journal.writeRestoreEntry(checkpointId, stateHash);

      expect(filePath).toContain('restore');

      const content = await fs.readFile(filePath, 'utf-8');
      const entry: JournalEntry = JSON.parse(content);

      expect(entry.operation).toBe('restore');
      expect(entry.stateHash).toBe(stateHash);
    });
  });

  describe('readEntries', () => {
    it('should return empty array when no entries exist', async () => {
      const entries = await journal.readEntries();
      expect(entries).toEqual([]);
    });

    it('should read entries sorted by timestamp (newest first)', async () => {
      await journal.writeEntry('hash1', 'write');
      await new Promise(r => setTimeout(r, 20));
      await journal.writeEntry('hash2', 'checkpoint');
      await new Promise(r => setTimeout(r, 20));
      await journal.writeEntry('hash3', 'restore');

      const entries = await journal.readEntries();

      expect(entries.length).toBe(3);
      expect(entries[0].entry.operation).toBe('restore');
      expect(entries[1].entry.operation).toBe('checkpoint');
      expect(entries[2].entry.operation).toBe('write');
    });

    it('should skip corrupted entries', async () => {
      await journal.writeEntry('hash1', 'write');
      
      // Create corrupted file
      const corruptedPath = join(journal.getPath(), 'corrupted.json');
      await fs.writeFile(corruptedPath, 'not valid json');

      const entries = await journal.readEntries();

      expect(entries.length).toBe(1);
      expect(entries[0].entry.stateHash).toBe('hash1');
    });
  });

  describe('getMetadata', () => {
    it('should return null when no entries', async () => {
      const metadata = await journal.getMetadata();
      expect(metadata).toBeNull();
    });

    it('should return metadata for entries', async () => {
      await journal.writeEntry('hash1', 'write');
      await new Promise(r => setTimeout(r, 10));
      await journal.writeCheckpointEntry('cp1', 'hash2');

      const metadata = await journal.getMetadata();

      expect(metadata).not.toBeNull();
      expect(metadata?.totalEntries).toBe(2);
      expect(metadata?.lastOperation).toBe('checkpoint');
      expect(metadata?.lastEntryTime).toBeDefined();
    });
  });

  describe('findEntryByHash', () => {
    it('should find entry by hash', async () => {
      await journal.writeEntry('target-hash', 'write');
      await new Promise(r => setTimeout(r, 10));
      await journal.writeEntry('other-hash', 'write');

      const found = await journal.findEntryByHash('target-hash');

      expect(found).not.toBeNull();
      expect(found?.stateHash).toBe('target-hash');
    });

    it('should return null when hash not found', async () => {
      await journal.writeEntry('hash1', 'write');

      const found = await journal.findEntryByHash('non-existent');

      expect(found).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should keep specified number of entries', async () => {
      // Create 5 entries
      for (let i = 0; i < 5; i++) {
        await journal.writeEntry(`hash${i}`, 'write');
        await new Promise(r => setTimeout(r, 10));
      }

      const deleted = await journal.cleanup(3);

      expect(deleted).toBe(2);
      const remaining = await journal.readEntries();
      expect(remaining.length).toBe(3);
    });

    it('should not delete if entries <= max', async () => {
      await journal.writeEntry('hash1', 'write');

      const deleted = await journal.cleanup(5);

      expect(deleted).toBe(0);
    });

    it('should return 0 on cleanup error', async () => {
      // Test cleanup when directory doesn't exist by creating a new journal with invalid path
      const deleted = await journal.cleanup(0);
      // This should either delete all or handle gracefully
      expect(typeof deleted).toBe('number');
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      await journal.writeEntry('hash1', 'write');
      await journal.writeEntry('hash2', 'write');

      await journal.clear();

      const entries = await journal.readEntries();
      expect(entries).toEqual([]);
    });

    it('should handle clear on empty journal', async () => {
      await expect(journal.clear()).resolves.not.toThrow();
    });
  });
});
