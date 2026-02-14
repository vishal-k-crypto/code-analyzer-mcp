/**
 * Task Management Types
 * Type definitions for task-related structures
 */

import type { BoundedContext } from './state.js';

export interface FileRelevance {
  path: string;
  score: number;
  signals: {
    lexicalMatch: number;
    semanticMatch: number;
    dependencyDistance: number;
    historicalCohesion: number;
  };
}

export interface FileIndex {
  files: IndexedFile[];
  lastUpdated: Date;
}

export interface SemanticIndex {
  documentFrequency: Map<string, number>;
  totalDocuments: number;
}

export interface FileChunk {
  id: string;
  content: string;
  startLine: number;
  endLine: number;
  embedding: number[];
}

export interface IndexedFile {
  path: string;
  language: string;
  content: string;
  tokens: string[];
  embedding?: number[];
  chunks?: FileChunk[];
  imports: string[];
  importedBy: string[];
}

export interface TaskTemplate {
  name: string;
  description: string;
  generateContext: (task: import('./state.js').Task) => BoundedContext;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  files: ModifiedFile[];
  notes: string;
  timestamp: Date;
}

export interface ModifiedFile {
  path: string;
  content: string;
  previousContent?: string;
}

export interface Roadmap {
  phases: import('./state.js').Phase[];
  tasks: import('./state.js').Task[];
  estimatedCompletion: Date;
}
