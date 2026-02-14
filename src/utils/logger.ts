/**
 * Logger Utility
 * Structured logging for the orchestrator
 */

import winston from 'winston';

export function createLogger(projectPath: string, level = 'info'): winston.Logger {
  return winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: 'orchestrator-mcp' },
    transports: [
      new winston.transports.File({
        filename: `${projectPath}/.orchestrator/orchestrator.log`,
        maxsize: 5242880, // 5MB
        maxFiles: 5
      })
    ]
  });
}
