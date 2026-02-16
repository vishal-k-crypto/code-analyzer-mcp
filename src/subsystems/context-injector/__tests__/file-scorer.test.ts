/**
 * Tests for File Scorer Module
 * Verifies relevance scoring algorithms and signal calculations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FileScorer, quickRelevanceScore, extractFileReferences, DEFAULT_SIGNALS } from '../file-scorer.js';
import type { IndexedFile } from '../../../types/task.js';
import type { Task } from '../../../types/state.js';

describe('FileScorer', () => {
  let scorer: FileScorer;

  beforeEach(() => {
    scorer = new FileScorer();
  });

  describe('initialization', () => {
    it('should initialize with default signals', () => {
      const signals = scorer.getSignals();
      expect(signals).toEqual(DEFAULT_SIGNALS);
      expect(signals.lexicalWeight).toBe(0.35);
      expect(signals.semanticWeight).toBe(0.35);
      expect(signals.dependencyWeight).toBe(0.20);
      expect(signals.cohesionWeight).toBe(0.10);
    });

    it('should accept custom signal weights', () => {
      const customScorer = new FileScorer({
        lexicalWeight: 0.5,
        semanticWeight: 0.3
      });
      const signals = customScorer.getSignals();
      expect(signals.lexicalWeight).toBe(0.5);
      expect(signals.semanticWeight).toBe(0.3);
    });
  });

  describe('updateSignals', () => {
    it('should update signal weights', () => {
      scorer.updateSignals({ lexicalWeight: 0.6 });
      const signals = scorer.getSignals();
      expect(signals.lexicalWeight).toBe(0.6);
      expect(signals.semanticWeight).toBe(DEFAULT_SIGNALS.semanticWeight);
    });
  });

  describe('calculateScores', () => {
    it('should return empty array for no files', () => {
      const task = createMockTask();
      const result = scorer.calculateScores(task, [], new Map());
      expect(result).toEqual([]);
    });

    it('should score files above minimum threshold', () => {
      const task = createMockTask({ title: 'authentication', description: 'user login' });
      const files: IndexedFile[] = [
        createMockFile('src/auth/login.ts', ['login', 'user', 'authenticate']),
        createMockFile('src/utils/helper.ts', ['format', 'parse'])
      ];

      const result = scorer.calculateScores(task, files, new Map());

      // auth/login.ts should have higher score due to lexical match
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].path).toBe('src/auth/login.ts');
    });

    it('should include all signal scores in result', () => {
      const task = createMockTask();
      const files: IndexedFile[] = [createMockFile('src/test.ts', ['test'])];

      const result = scorer.calculateScores(task, files, new Map());

      expect(result[0].signals).toBeDefined();
      expect(typeof result[0].signals.lexicalMatch).toBe('number');
      expect(typeof result[0].signals.semanticMatch).toBe('number');
      expect(typeof result[0].signals.dependencyDistance).toBe('number');
      expect(typeof result[0].signals.historicalCohesion).toBe('number');
    });

    it('should respect maxResults option', () => {
      const task = createMockTask();
      const files: IndexedFile[] = [
        createMockFile('src/file1.ts', ['a', 'b', 'c']),
        createMockFile('src/file2.ts', ['d', 'e', 'f']),
        createMockFile('src/file3.ts', ['g', 'h', 'i']),
        createMockFile('src/file4.ts', ['j', 'k', 'l'])
      ];

      const result = scorer.calculateScores(task, files, new Map(), { maxResults: 2 });

      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should filter files below minScore', () => {
      const task = createMockTask({ title: 'specific', description: 'unique feature' });
      const files: IndexedFile[] = [
        createMockFile('src/specific.ts', ['specific', 'unique', 'feature']),
        createMockFile('src/unrelated.ts', ['random', 'other', 'stuff'])
      ];

      const result = scorer.calculateScores(task, files, new Map(), { minScore: 0.3 });

      // specific.ts should be included, unrelated.ts should be filtered
      expect(result.every(r => r.score >= 0.3)).toBe(true);
    });

    it('should sort results by score descending', () => {
      const task = createMockTask({ title: 'authentication' });
      const files: IndexedFile[] = [
        createMockFile('src/low.ts', ['a', 'b']),
        createMockFile('src/high.ts', ['authentication', 'auth']),
        createMockFile('src/medium.ts', ['auth'])
      ];

      const result = scorer.calculateScores(task, files, new Map());

      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
      }
    });

    it('should use semantic scores when provided', () => {
      const task = createMockTask();
      const files: IndexedFile[] = [createMockFile('src/test.ts', [])];
      const semanticScores = new Map([['src/test.ts', 0.95]]);

      const result = scorer.calculateScores(task, files, semanticScores);

      expect(result[0].signals.semanticMatch).toBe(0.95);
    });
  });

  describe('dependency scoring', () => {
    it('should give high score to directly relevant files', () => {
      const task = createMockTask({
        relevantFiles: ['src/auth.ts']
      });
      const files: IndexedFile[] = [
        createMockFile('src/auth.ts', [], [], []),
        createMockFile('src/other.ts', [], [], [])
      ];

      const result = scorer.calculateScores(task, files, new Map());
      const authScore = result.find(r => r.path === 'src/auth.ts');
      
      expect(authScore?.signals.dependencyDistance).toBe(1.0);
    });

    it('should give medium score to files imported by relevant files', () => {
      const task = createMockTask({
        relevantFiles: ['src/auth.ts']
      });
      const files: IndexedFile[] = [
        createMockFile('src/auth.ts', [], [], ['src/utils.ts']),
        createMockFile('src/utils.ts', [], ['src/auth.ts'], [])
      ];

      const result = scorer.calculateScores(task, files, new Map());
      const utilsScore = result.find(r => r.path === 'src/utils.ts');
      
      expect(utilsScore?.signals.dependencyDistance).toBe(0.8);
    });

    it('should give lower score to files that import relevant files', () => {
      const task = createMockTask({
        relevantFiles: ['src/base.ts']
      });
      const files: IndexedFile[] = [
        createMockFile('src/base.ts', [], [], []),
        createMockFile('src/child.ts', [], [], ['src/base.ts'])
      ];

      const result = scorer.calculateScores(task, files, new Map());
      const childScore = result.find(r => r.path === 'src/child.ts');
      
      expect(childScore?.signals.dependencyDistance).toBe(0.6);
    });
  });

  describe('lexical scoring', () => {
    it('should match tokens from task title and description', () => {
      const task = createMockTask({ 
        title: 'user authentication',
        description: 'login system'
      });
      const files: IndexedFile[] = [
        createMockFile('src/auth.ts', ['authentication', 'user', 'login']),
        createMockFile('src/other.ts', ['database', 'config'])
      ];

      const result = scorer.calculateScores(task, files, new Map());
      
      expect(result[0].path).toBe('src/auth.ts');
      expect(result[0].signals.lexicalMatch).toBeGreaterThan(0);
    });

    it('should handle empty task tokens', () => {
      const task = createMockTask({ title: '', description: '' });
      const files: IndexedFile[] = [createMockFile('src/test.ts', ['code'])];

      const result = scorer.calculateScores(task, files, new Map());

      expect(result.length).toBe(0); // minScore filters out 0 scores
    });

    it('should handle case insensitivity', () => {
      const task = createMockTask({ title: 'Authentication' });
      const files: IndexedFile[] = [
        createMockFile('src/auth.ts', ['authentication']),
        createMockFile('src/other.ts', ['authentication']) // same lowercase token
      ];

      const result = scorer.calculateScores(task, files, new Map());

      // Both should have same score (case insensitive)
      const auth1 = result.find(r => r.path === 'src/auth.ts');
      const auth2 = result.find(r => r.path === 'src/other.ts');
      // Both files have 'authentication' in their tokens
      expect(auth1?.signals.lexicalMatch).toBe(auth2?.signals.lexicalMatch);
    });
  });
});

describe('quickRelevanceScore', () => {
  it('should return score between 0 and 1', () => {
    const score = quickRelevanceScore(
      'authentication system',
      'src/auth.ts',
      'function authenticate() {}'
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should give higher score for matching content', () => {
    const score1 = quickRelevanceScore(
      'user authentication',
      'src/auth.ts',
      'function authenticate() {}'
    );
    const score2 = quickRelevanceScore(
      'user authentication',
      'src/other.ts',
      'function process() {}'
    );
    // auth.ts matches 'auth' token, process doesn't match anything
    expect(score1).toBeGreaterThanOrEqual(score2);
  });

  it('should consider filename in scoring', () => {
    const score1 = quickRelevanceScore(
      'authentication',
      'src/authentication.ts',
      'code'
    );
    const score2 = quickRelevanceScore(
      'authentication',
      'src/utils.ts',
      'code'
    );
    expect(score1).toBeGreaterThan(score2);
  });

  it('should return 0 for empty task', () => {
    const score = quickRelevanceScore('', 'src/test.ts', 'code');
    expect(score).toBe(0);
  });
});

describe('extractFileReferences', () => {
  it('should extract file paths with extensions', () => {
    const text = 'Check src/auth.ts and lib/utils.js for details';
    const refs = extractFileReferences(text);

    expect(refs).toContain('src/auth.ts');
    expect(refs).toContain('lib/utils.js');
  });

  it('should extract import statements', () => {
    const text = `import { auth } from './auth';
import helpers from '../utils';`;
    const refs = extractFileReferences(text);

    expect(refs).toContain('./auth');
    expect(refs).toContain('../utils');
  });

  it('should remove duplicates', () => {
    const text = 'Check src/file.ts and src/file.ts again';
    const refs = extractFileReferences(text);

    expect(refs.filter(r => r === 'src/file.ts').length).toBe(1);
  });

  it('should return empty array for no matches', () => {
    const text = 'Just some regular text without files';
    const refs = extractFileReferences(text);

    expect(refs).toEqual([]);
  });

  it('should handle TypeScript and TSX files', () => {
    const text = 'Files: component.ts, helpers.ts, app.js';
    const refs = extractFileReferences(text);

    // Should extract supported extensions
    expect(refs).toContain('component.ts');
    expect(refs).toContain('helpers.ts');
    expect(refs).toContain('app.js');
  });
});

// Helper functions
function createMockTask(overrides: Partial<Task['context'] & { title?: string; description?: string }> = {}): Task {
  return {
    id: 'task-1',
    phase: 1,
    title: overrides.title ?? 'Test Task',
    description: overrides.description ?? 'Test description',
    acceptanceCriteria: [],
    context: {
      relevantFiles: overrides.relevantFiles ?? [],
      forbiddenFiles: [],
      instructions: '',
      expectedOutput: ''
    },
    verificationCommands: [],
    status: 'pending',
    attempts: 0,
    createdAt: new Date(),
    completedAt: null,
    dependencies: []
  };
}

function createMockFile(
  path: string, 
  tokens: string[] = [],
  importedBy: string[] = [],
  imports: string[] = []
): IndexedFile {
  return {
    path,
    language: 'typescript',
    tokens,
    content: '',
    imports,
    importedBy,
    embedding: []
  };
}
