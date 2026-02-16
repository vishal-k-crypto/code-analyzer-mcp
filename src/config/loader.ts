/**
 * Configuration Loader
 * Loads configuration from files and environment variables
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Config, validateConfig } from './schema.js';
import {
  DEFAULT_QUALITY_THRESHOLD,
  DEFAULT_MAX_RETRIES,
  DEFAULT_LOG_LEVEL,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_INDEX_EXTENSIONS
} from './defaults.js';

// Configuration file names to search for
const CONFIG_FILES = [
  '.orchestratorrc.json',
  '.orchestratorrc.js',
  'orchestrator.config.json',
  'orchestrator.config.js'
];

/**
 * Load configuration from a file
 */
async function loadConfigFile(projectPath: string): Promise<Partial<Config> | null> {
  for (const fileName of CONFIG_FILES) {
    const filePath = join(projectPath, fileName);
    
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      if (fileName.endsWith('.json')) {
        const content = await readFile(filePath, 'utf-8');
        return JSON.parse(content);
      } else if (fileName.endsWith('.js')) {
        // For ESM, we need to import the file
        const module = await import(filePath);
        return module.default || module;
      }
    } catch (error) {
      console.warn(`Failed to load config from ${filePath}:`, error);
    }
  }

  return null;
}

/**
 * Load configuration from environment variables
 */
function loadEnvConfig(): Partial<Config> {
  const env: Partial<Config> = {};

  if (process.env.ORCHESTRATOR_QUALITY_THRESHOLD) {
    env.qualityThreshold = parseInt(process.env.ORCHESTRATOR_QUALITY_THRESHOLD, 10);
  }

  if (process.env.ORCHESTRATOR_MAX_RETRIES) {
    env.maxRetries = parseInt(process.env.ORCHESTRATOR_MAX_RETRIES, 10);
  }

  if (process.env.ORCHESTRATOR_LOG_LEVEL) {
    env.logLevel = process.env.ORCHESTRATOR_LOG_LEVEL as any;
  }

  if (process.env.ORCHESTRATOR_IGNORE_PATTERNS) {
    env.ignorePatterns = process.env.ORCHESTRATOR_IGNORE_PATTERNS.split(',');
  }

  // LLM configuration
  const llmConfig: any = {};
  
  if (process.env.OPENAI_API_KEY) {
    llmConfig.provider = 'openai';
    llmConfig.apiKey = process.env.OPENAI_API_KEY;
    llmConfig.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  } else if (process.env.ANTHROPIC_API_KEY) {
    llmConfig.provider = 'anthropic';
    llmConfig.apiKey = process.env.ANTHROPIC_API_KEY;
    llmConfig.model = process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307';
  } else if (process.env.LLM_API_KEY && process.env.LLM_BASE_URL) {
    llmConfig.provider = 'custom';
    llmConfig.apiKey = process.env.LLM_API_KEY;
    llmConfig.baseUrl = process.env.LLM_BASE_URL;
    llmConfig.model = process.env.LLM_MODEL || 'custom-model';
  }

  if (Object.keys(llmConfig).length > 0) {
    env.llm = llmConfig;
  }

  return env;
}

/**
 * Load complete configuration
 * Priority: CLI args > Environment > Config file > Defaults
 */
export async function loadConfig(
  projectPath: string,
  cliOverrides?: Partial<Config>
): Promise<{ success: true; config: Config } | { success: false; error: string }> {
  // Start with defaults
  const defaults: Partial<Config> = {
    projectPath,
    qualityThreshold: DEFAULT_QUALITY_THRESHOLD,
    maxRetries: DEFAULT_MAX_RETRIES,
    logLevel: DEFAULT_LOG_LEVEL,
    retryConfig: DEFAULT_RETRY_CONFIG,
    ignorePatterns: DEFAULT_IGNORE_PATTERNS,
    indexExtensions: DEFAULT_INDEX_EXTENSIONS
  };

  // Load from config file
  const fileConfig = await loadConfigFile(projectPath);

  // Load from environment
  const envConfig = loadEnvConfig();

  // Merge configurations (CLI overrides take highest priority)
  const merged: Partial<Config> = {
    ...defaults,
    ...fileConfig,
    ...envConfig,
    ...cliOverrides,
    // Deep merge for nested objects
    features: {
      semanticSearch: true,
      vectorIndexing: true,
      targetedTesting: true,
      astVerification: true,
      checkpoints: true,
      journaling: true,
      ...fileConfig?.features,
      ...envConfig?.features,
      ...cliOverrides?.features
    },
    llm: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.2,
      maxTokens: 2000,
      timeout: 30000,
      ...fileConfig?.llm,
      ...envConfig?.llm,
      ...cliOverrides?.llm
    }
  };

  // Validate final configuration
  const validation = validateConfig(merged);
  
  if (!validation.success) {
    return { success: false, error: validation.error };
  }

  return { success: true, config: validation.data };
}

/**
 * Get configuration summary for logging
 */
export function getConfigSummary(config: Config): string {
  const lines = [
    'Configuration:',
    `  Project Path: ${config.projectPath}`,
    `  Quality Threshold: ${config.qualityThreshold}`,
    `  Max Retries: ${config.maxRetries}`,
    `  Log Level: ${config.logLevel}`,
    `  LLM Provider: ${config.llm?.provider || 'none (rule-based fallback)'}`
  ];

  if (config.features) {
    lines.push('  Features:');
    for (const [key, value] of Object.entries(config.features)) {
      lines.push(`    ${key}: ${value}`);
    }
  }

  return lines.join('\n');
}
