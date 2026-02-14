/**
 * MCP Server Setup
 * Configures and starts the MCP server
 */

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio.js';
import { Orchestrator } from './core/orchestrator.js';
import { registerTools, registerResources, registerPrompts } from './mcp/index.js';
import { isLLMAvailable, getLLMConfig } from './utils/config.js';
import winston from 'winston';

export interface ServerConfig {
  projectPath: string;
  qualityThreshold?: number;
  logLevel?: string;
}

export async function startServer(config: ServerConfig): Promise<void> {
  // Setup logging
  const logger = winston.createLogger({
    level: config.logLevel || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.File({ 
        filename: `${config.projectPath}/.orchestrator/orchestrator.log` 
      })
    ]
  });

  // Log LLM status
  if (isLLMAvailable()) {
    const llmConfig = getLLMConfig();
    logger.info(`LLM configured: ${llmConfig.provider} (${llmConfig.model})`);
  } else {
    logger.info('LLM not configured - set OPENAI_API_KEY, ANTHROPIC_API_KEY, or LLM_API_KEY for AI-powered requirement parsing');
  }

  // Initialize orchestrator
  const orchestrator = new Orchestrator({
    projectPath: config.projectPath,
    qualityThreshold: config.qualityThreshold
  });

  await orchestrator.init();
  logger.info('Orchestrator initialized');

  // Create MCP server
  const server = new McpServer(
    {
      name: 'orchestrator-mcp-server',
      version: '1.0.0',
      websiteUrl: 'https://github.com/orchestrator-mcp'
    },
    {
      capabilities: {
        logging: {},
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );

  // Register tools, resources, and prompts
  registerTools(server, orchestrator);
  registerResources(server, orchestrator);
  registerPrompts(server, orchestrator);

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.connect(transport);
  logger.info('MCP server connected to stdio transport');

  console.error('Orchestrator MCP Server running on stdio');
}
