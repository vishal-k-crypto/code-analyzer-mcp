/**
 * Configuration Schema Validation
 * Zod schemas for configuration validation
 */

import { z } from 'zod';

// Retry configuration schema
const RetryConfigSchema = z.record(z.number().min(0).max(10));

// LLM configuration schema
const LLMConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'custom']),
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().min(100).max(8000).default(2000),
  timeout: z.number().min(1000).max(120000).default(30000)
});

// Vector store configuration schema
const VectorConfigSchema = z.object({
  embeddingModel: z.string().default('Xenova/all-MiniLM-L6-v2'),
  chunkSize: z.number().min(100).max(2000).default(512),
  chunkOverlap: z.number().min(0).max(500).default(50),
  maxResults: z.number().min(1).max(50).default(10)
});

// Context limits schema
const ContextLimitsSchema = z.object({
  maxEssentialFiles: z.number().min(1).max(50).default(15),
  maxReferenceFiles: z.number().min(0).max(30).default(10),
  maxTotalTokens: z.number().min(1000).max(32000).default(8000),
  maxFileSizeBytes: z.number().min(1000).max(1000000).default(100000)
});

// Scoring weights schema
const ScoringWeightsSchema = z.object({
  requirementsCoverage: z.number().min(0).max(1).default(0.40),
  testPassRate: z.number().min(0).max(1).default(0.30),
  codeQuality: z.number().min(0).max(1).default(0.15),
  implementationCompleteness: z.number().min(0).max(1).default(0.15)
}).refine(
  (data) => Math.abs(data.requirementsCoverage + data.testPassRate + data.codeQuality + data.implementationCompleteness - 1) < 0.01,
  { message: 'Scoring weights must sum to 1.0' }
);

// Main configuration schema
export const ConfigSchema = z.object({
  // Core settings
  projectPath: z.string().min(1),
  qualityThreshold: z.number().min(0).max(100).default(85),
  maxRetries: z.number().min(1).max(10).default(5),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  
  // Retry configuration
  retryConfig: RetryConfigSchema.default({}),
  
  // File patterns
  ignorePatterns: z.array(z.string()).default([]),
  indexExtensions: z.array(z.string()).default([]),
  
  // Feature flags
  features: z.object({
    semanticSearch: z.boolean().default(true),
    vectorIndexing: z.boolean().default(true),
    targetedTesting: z.boolean().default(true),
    astVerification: z.boolean().default(true),
    checkpoints: z.boolean().default(true),
    journaling: z.boolean().default(true)
  }).default({}),
  
  // Subsystem configurations
  llm: LLMConfigSchema.optional(),
  vector: VectorConfigSchema.default({}),
  contextLimits: ContextLimitsSchema.default({}),
  scoringWeights: ScoringWeightsSchema.default({})
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Validate configuration object
 */
export function validateConfig(config: unknown): { success: true; data: Config } | { success: false; error: string } {
  try {
    const validated = ConfigSchema.parse(config);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return { success: false, error: messages.join('\n') };
    }
    return { success: false, error: String(error) };
  }
}

/**
 * Merge partial configuration with defaults
 */
export function mergeWithDefaults(partial: Partial<Config>): Config {
  return ConfigSchema.parse({
    projectPath: partial.projectPath || process.cwd(),
    ...partial
  });
}
