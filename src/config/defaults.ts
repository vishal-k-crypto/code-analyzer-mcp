/**
 * Default Configuration Values
 */

import type { OrchestratorConfig } from '../core/orchestrator.js';

export const DEFAULT_QUALITY_THRESHOLD = 85;

export const DEFAULT_MAX_RETRIES = 5;

export const DEFAULT_LOG_LEVEL = 'info';

export const DEFAULT_CONFIG: Partial<OrchestratorConfig> = {
  qualityThreshold: DEFAULT_QUALITY_THRESHOLD,
  maxRetries: DEFAULT_MAX_RETRIES
};

// Retry configuration by error type
export const DEFAULT_RETRY_CONFIG: Record<string, number> = {
  syntax: 5,
  type: 3,
  test: 3,
  runtime: 3,
  lint: 2,
  timeout: 2,
  crash: 3,
  dependency: 1
};

// File patterns to ignore
export const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.orchestrator/**',
  '**/target/**',
  '**/__pycache__/**',
  '**/*.min.js',
  '**/*.map',
  '**/coverage/**',
  '**/.nyc_output/**'
];

// File extensions to index
export const DEFAULT_INDEX_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx',
  '.py', '.rs', '.go', '.java',
  '.rb', '.php', '.cs', '.cpp',
  '.c', '.h', '.hpp', '.swift',
  '.kt', '.scala', '.r', '.m'
];

// Context assembly limits
export const DEFAULT_CONTEXT_LIMITS = {
  maxEssentialFiles: 15,
  maxReferenceFiles: 10,
  maxTotalTokens: 8000,
  maxFileSizeBytes: 100000 // 100KB
};

// Scoring weights
export const DEFAULT_SCORING_WEIGHTS = {
  requirementsCoverage: 0.40,
  testPassRate: 0.30,
  codeQuality: 0.15,
  implementationCompleteness: 0.15
};

// LLM configuration
export const DEFAULT_LLM_CONFIG = {
  provider: 'openai' as const,
  model: 'gpt-4o-mini',
  temperature: 0.2,
  maxTokens: 2000,
  timeout: 30000
};

// Vector store configuration
export const DEFAULT_VECTOR_CONFIG = {
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  chunkSize: 512,
  chunkOverlap: 50,
  maxResults: 10
};

// Journal configuration
export const DEFAULT_JOURNAL_CONFIG = {
  maxEntries: 50,
  enabled: true
};

// Checkpoint configuration
export const DEFAULT_CHECKPOINT_CONFIG = {
  maxCheckpoints: 10,
  enabled: true
};
