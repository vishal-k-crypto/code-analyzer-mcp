/**
 * Generic Error Parser
 * Fallback parser for unknown formats
 */

import { ErrorParser } from './base.js';
import type { ParsedError, TestResults } from '../../../types/score.js';

export class GenericErrorParser extends ErrorParser {
  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');
    
    // Generic pattern: file.ext:line: message
    const genericRegex = /^(.+\.[a-z]+):(\d+):\s*(.+)$/i;

    for (let i = 0; i < lines.length; i++) {
      const match = genericRegex.exec(lines[i]);
      if (match) {
        errors.push({
          type: 'syntax',
          severity: 'error',
          file: match[1],
          line: parseInt(match[2], 10),
          column: 0,
          message: match[3],
          code: '',
          context: this.extractContext(lines, i)
        });
      }
    }

    return errors;
  }
}

/**
 * Parse generic test results
 */
export function parseGenericTestResults(output: string): TestResults | undefined {
  let total = 0;
  let passed = 0;
  let failed = 0;

  // Look for common patterns
  const passMatch = output.match(/(\d+)\s*passed/i);
  const failMatch = output.match(/(\d+)\s*failed/i);

  if (passMatch) passed = parseInt(passMatch[1], 10);
  if (failMatch) failed = parseInt(failMatch[1], 10);

  total = passed + failed;

  if (total === 0) return undefined;

  return {
    total,
    passed,
    failed,
    skipped: 0,
    duration: 0,
    suites: []
  };
}

/**
 * Get appropriate parser for command
 */
export function getParser(command: string): ErrorParser {
  const { TypeScriptErrorParser } = require('./typescript.js');
  const { ESLintErrorParser } = require('./eslint.js');
  const { PytestErrorParser } = require('./python.js');
  const { RustErrorParser } = require('./rust.js');
  const { GoErrorParser } = require('./go.js');

  if (command.includes('tsc')) {
    return new TypeScriptErrorParser();
  }
  if (command.includes('eslint')) {
    return new ESLintErrorParser();
  }
  if (command.includes('pytest')) {
    return new PytestErrorParser();
  }
  if (command.includes('cargo')) {
    return new RustErrorParser();
  }
  if (command.includes('go')) {
    return new GoErrorParser();
  }

  return new GenericErrorParser();
}
