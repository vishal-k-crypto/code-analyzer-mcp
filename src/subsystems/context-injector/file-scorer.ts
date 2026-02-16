/**
 * File Scorer Module
 * Calculates relevance scores for files based on task context
 * 
 * Implements multi-signal file scoring:
 * - Lexical matching (keyword overlap)
 * - Semantic matching (vector embeddings)
 * - Dependency distance (import graph proximity)
 * - Historical cohesion (files changed together)
 */

import type { Task } from '../../types/state.js';
import type { FileRelevance, IndexedFile } from '../../types/task.js';

export interface ScoringSignals {
  lexicalWeight: number;
  semanticWeight: number;
  dependencyWeight: number;
  cohesionWeight: number;
}

export interface ScoringOptions {
  signals?: Partial<ScoringSignals>;
  minScore?: number;
  maxResults?: number;
}

export const DEFAULT_SIGNALS: ScoringSignals = {
  lexicalWeight: 0.35,
  semanticWeight: 0.35,
  dependencyWeight: 0.20,
  cohesionWeight: 0.10
};

/**
 * FileScorer - Calculates file relevance for task context assembly
 */
export class FileScorer {
  private signals: ScoringSignals;

  constructor(signals: Partial<ScoringSignals> = {}) {
    this.signals = { ...DEFAULT_SIGNALS, ...signals };
  }

  /**
   * Calculate relevance scores for all files
   */
  calculateScores(
    task: Task,
    files: IndexedFile[],
    semanticScores: Map<string, number>,
    options: ScoringOptions = {}
  ): FileRelevance[] {
    const minScore = options.minScore ?? 0.1;
    const maxResults = options.maxResults ?? 20;

    const taskTokens = this.tokenize(task.title + ' ' + task.description);
    const relevanceScores: FileRelevance[] = [];

    for (const file of files) {
      // Calculate individual signal scores
      const lexicalScore = this.computeLexicalScore(taskTokens, file.tokens);
      const semanticScore = semanticScores.get(file.path) || 0;
      const dependencyScore = this.computeDependencyScore(task, file, files);
      const cohesionScore = this.computeCohesionScore(task, file);

      // Combined weighted score
      const score = 
        lexicalScore * this.signals.lexicalWeight +
        semanticScore * this.signals.semanticWeight +
        dependencyScore * this.signals.dependencyWeight +
        cohesionScore * this.signals.cohesionWeight;

      relevanceScores.push({
        path: file.path,
        score,
        signals: {
          lexicalMatch: lexicalScore,
          semanticMatch: semanticScore,
          dependencyDistance: dependencyScore,
          historicalCohesion: cohesionScore
        }
      });
    }

    // Filter and sort by score
    return relevanceScores
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  /**
   * Compute lexical match score based on token overlap
   */
  private computeLexicalScore(taskTokens: string[], fileTokens: string[]): number {
    const taskSet = new Set(taskTokens);
    const fileSet = new Set(fileTokens);
    
    if (taskSet.size === 0) return 0;

    let matches = 0;
    for (const token of taskSet) {
      if (fileSet.has(token)) {
        matches++;
      }
    }

    return matches / taskSet.size;
  }

  /**
   * Compute dependency distance score
   * Higher score for files closer to explicitly mentioned files in import graph
   */
  private computeDependencyScore(task: Task, file: IndexedFile, allFiles: IndexedFile[]): number {
    // Direct match with relevant files
    if (task.context.relevantFiles.includes(file.path)) {
      return 1.0;
    }

    // Check if file is imported by relevant files (reverse dependency)
    for (const relevantPath of task.context.relevantFiles) {
      if (file.importedBy.includes(relevantPath)) {
        return 0.8;
      }
    }

    // Check if file imports relevant files (forward dependency)
    for (const relevantPath of task.context.relevantFiles) {
      if (file.imports.includes(relevantPath)) {
        return 0.6;
      }
    }

    // Check second-degree dependencies (file imported by files that are imported by relevant files)
    for (const relevantPath of task.context.relevantFiles) {
      const relevantFile = allFiles.find(f => f.path === relevantPath);
      if (relevantFile) {
        for (const importer of relevantFile.importedBy) {
          if (file.importedBy.includes(importer)) {
            return 0.4;
          }
        }
      }
    }

    return 0;
  }

  /**
   * Compute cohesion score based on historical changes
   * This would track files commonly changed together
   * For now, returns a neutral score
   */
  private computeCohesionScore(_task: Task, _file: IndexedFile): number {
    // TODO: Implement historical cohesion tracking
    // This would require:
    // 1. Tracking file change history
    // 2. Building co-occurrence matrix
    // 3. Calculating cohesion based on change patterns
    return 0.5;
  }

  /**
   * Simple tokenization for lexical matching
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  /**
   * Update scoring signal weights
   */
  updateSignals(signals: Partial<ScoringSignals>): void {
    this.signals = { ...this.signals, ...signals };
  }

  /**
   * Get current signal weights
   */
  getSignals(): ScoringSignals {
    return { ...this.signals };
  }
}

/**
 * Quick relevance score for a single file
 * Useful when you don't need full scoring of all files
 */
export function quickRelevanceScore(
  taskDescription: string,
  filePath: string,
  fileContent: string
): number {
  const taskTokens = new Set(
    taskDescription
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
  );

  const fileTokens = new Set(
    fileContent
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
  );

  // Filename matching
  const fileNameTokens = filePath
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);

  let matches = 0;
  for (const token of taskTokens) {
    if (fileTokens.has(token) || fileNameTokens.some(ft => ft.includes(token))) {
      matches++;
    }
  }

  return taskTokens.size > 0 ? matches / taskTokens.size : 0;
}

/**
 * Extract file references from text using common patterns
 */
export function extractFileReferences(text: string): string[] {
  const refs: string[] = [];
  
  // Match file paths with extensions
  const filePattern = /[\w./-]+\.(ts|tsx|js|jsx|py|rs|go|java|rb|php)/gi;
  let match;
  while ((match = filePattern.exec(text)) !== null) {
    refs.push(match[0]);
  }

  // Match import/require statements
  const importPattern = /(?:import|require|from)\s+['"]([^'"]+)['"]/g;
  while ((match = importPattern.exec(text)) !== null) {
    refs.push(match[1]);
  }

  return [...new Set(refs)];
}
