/**
 * Logger Utility
 * Structured logging for the orchestrator with Winston
 */

import winston from 'winston';
import { join } from 'path';

export interface LoggerConfig {
  projectPath: string;
  level?: string;
  console?: boolean;
  logFile?: boolean;
}

/**
 * Create a Winston logger with file and optional console output
 */
export function createLogger(config: LoggerConfig): winston.Logger {
  const level = config.level || process.env.LOG_LEVEL || 'info';
  const enableConsole = config.console ?? process.env.NODE_ENV !== 'production';
  const enableLogFile = config.logFile ?? true;

  const transports: winston.transport[] = [];

  // File transport for persistent logging
  if (enableLogFile) {
    transports.push(
      new winston.transports.File({
        filename: join(config.projectPath, '.orchestrator', 'orchestrator.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      })
    );

    // Separate error log
    transports.push(
      new winston.transports.File({
        filename: join(config.projectPath, '.orchestrator', 'error.log'),
        level: 'error',
        maxsize: 5242880,
        maxFiles: 5,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      })
    );
  }

  // Console transport for development
  if (enableConsole) {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(({ level, message, timestamp, ...metadata }) => {
            let msg = `${timestamp} [${level}]: ${message}`;
            if (Object.keys(metadata).length > 0) {
              msg += ` ${JSON.stringify(metadata)}`;
            }
            return msg;
          })
        )
      })
    );
  }

  return winston.createLogger({
    level,
    defaultMeta: { 
      service: 'orchestrator-mcp',
      pid: process.pid
    },
    transports
  });
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(
  parent: winston.Logger, 
  meta: Record<string, unknown>
): winston.Logger {
  return parent.child(meta);
}

/**
 * Simple console logger fallback for when Winston is not available
 */
export interface SimpleLogger {
  error: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
}

export function createConsoleLogger(level = 'info'): SimpleLogger {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  const currentLevel = levels[level as keyof typeof levels] ?? 2;

  return {
    error: (msg: string, ...args: unknown[]) => {
      if (currentLevel >= 0) console.error('[ERROR]', msg, ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
      if (currentLevel >= 1) console.warn('[WARN]', msg, ...args);
    },
    info: (msg: string, ...args: unknown[]) => {
      if (currentLevel >= 2) console.info('[INFO]', msg, ...args);
    },
    debug: (msg: string, ...args: unknown[]) => {
      if (currentLevel >= 3) console.debug('[DEBUG]', msg, ...args);
    }
  };
}
