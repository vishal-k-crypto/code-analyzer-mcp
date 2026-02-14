/**
 * Configuration Utility
 * Manages environment variables and server configuration
 */

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'custom' | null;
  apiKey: string | null;
  model: string;
  baseUrl: string | null;
  maxTokens: number;
  temperature: number;
}

export interface ServerConfig {
  projectPath: string;
  qualityThreshold: number;
  maxRetries: number;
  logLevel: string;
  llm: LLMConfig;
}

/**
 * Get LLM configuration from environment variables
 */
export function getLLMConfig(): LLMConfig {
  // Check for OpenAI configuration
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      baseUrl: process.env.OPENAI_BASE_URL || null,
      maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '2000', 10),
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.1')
    };
  }

  // Check for Anthropic configuration
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
      baseUrl: process.env.ANTHROPIC_BASE_URL || null,
      maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '2000', 10),
      temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE || '0.1')
    };
  }

  // Check for custom LLM configuration
  const customKey = process.env.LLM_API_KEY;
  if (customKey) {
    return {
      provider: 'custom',
      apiKey: customKey,
      model: process.env.LLM_MODEL || 'default',
      baseUrl: process.env.LLM_BASE_URL || null,
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2000', 10),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.1')
    };
  }

  // No LLM configured
  return {
    provider: null,
    apiKey: null,
    model: 'none',
    baseUrl: null,
    maxTokens: 0,
    temperature: 0
  };
}

/**
 * Check if LLM is available
 */
export function isLLMAvailable(): boolean {
  const config = getLLMConfig();
  return config.provider !== null && config.apiKey !== null;
}

/**
 * Get full server configuration
 */
export function getServerConfig(
  projectPath: string,
  qualityThreshold = 85,
  logLevel = 'info'
): ServerConfig {
  return {
    projectPath,
    qualityThreshold,
    maxRetries: parseInt(process.env.MAX_RETRIES || '5', 10),
    logLevel,
    llm: getLLMConfig()
  };
}

/**
 * Validate that required LLM configuration is present
 */
export function validateLLMConfig(): { valid: boolean; error?: string } {
  const config = getLLMConfig();
  
  if (!config.provider) {
    return {
      valid: false,
      error: 'No LLM provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or LLM_API_KEY environment variable.'
    };
  }

  if (!config.apiKey) {
    return {
      valid: false,
      error: `LLM provider ${config.provider} configured but API key is missing.`
    };
  }

  return { valid: true };
}
