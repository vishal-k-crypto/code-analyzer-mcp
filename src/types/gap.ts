/**
 * Gap Analysis Types
 * Type definitions for gap detection and analysis
 */

export type GapType = 
  | 'MISSING_IMPLEMENTATION'
  | 'PARTIAL_IMPLEMENTATION'
  | 'SYNTAX_ERROR'
  | 'TEST_FAILURE'
  | 'MISSING_DEPENDENCY';

export interface Gap {
  id: string;
  type: GapType;
  requirement?: ParsedRequirement;
  file?: string;
  existingFiles: string[];
  missingParts: string[];
  detectedAt: Date;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface ParsedRequirement {
  id: string;
  description: string;
  type: 'feature' | 'bugfix' | 'refactor' | 'test';
  priority: 'critical' | 'high' | 'medium' | 'low';
  components: string[];
  acceptanceCriteria: string[];
  dependencies: string[];
}

export interface Evidence {
  found: boolean;
  complete: boolean;
  files: string[];
  missing: string[];
  confidence: number;
}

export interface CodebaseState {
  rootPath: string;
  sourceFiles: SourceFile[];
  configFiles: ConfigFile[];
  dependencyGraph: DependencyGraph;
  testFiles: string[];
}

export interface SourceFile {
  path: string;
  content: string;
  language: string;
  imports: string[];
  exports: string[];
  hasSyntaxErrors: boolean;
}

export interface ConfigFile {
  path: string;
  type: 'tsconfig' | 'package' | 'cargo' | 'pyproject' | 'go' | 'generic';
  content: unknown;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];
}

export interface DependencyNode {
  id: string;
  path: string;
  type: 'module' | 'library' | 'builtin';
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'import' | 'require' | 'dynamic';
}
