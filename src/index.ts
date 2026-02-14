#!/usr/bin/env node

/**
 * Orchestrator MCP Server
 * Entry point for the autonomous orchestration MCP server
 */

import { Command } from 'commander';
import { startServer } from './server.js';
import { resolve } from 'path';

const program = new Command();

program
  .name('orchestrator-mcp-server')
  .description('Autonomous Orchestration MCP Server - AI Coding Assistant Orchestrator')
  .version('1.0.0');

program
  .option('-p, --project <path>', 'Project directory path', process.cwd())
  .option('-t, --threshold <number>', 'Quality threshold (0-100)', '85')
  .option('-l, --log-level <level>', 'Log level', 'info')
  .action(async (options) => {
    try {
      const projectPath = resolve(options.project);
      const qualityThreshold = parseInt(options.threshold, 10);
      
      await startServer({
        projectPath,
        qualityThreshold,
        logLevel: options.logLevel
      });
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  });

program.parse();
