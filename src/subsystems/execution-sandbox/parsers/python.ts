/**
 * Python Error Parser
 * Parses pytest and Python-related errors
 */

import { ErrorParser } from './base.js';
import type { ParsedError, TestResults } from '../../../types/score.js';

export class PytestErrorParser extends ErrorParser {
  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');
    
    // Match: file.py::test_name - message
    // or: file.py:line: in function
    const regex = /^(.+\.py):(\d+):\s*(.+)$/;

    for (let i = 0; i < lines.length; i++) {
      const match = regex.exec(lines[i]);
      if (match) {
        errors.push({
          type: 'test',
          severity: 'error',
          file: match[1],
          line: parseInt(match[2], 10),
          column: 0,
          message: match[3],
          code: 'TEST_FAILURE',
          context: this.extractContext(lines, i)
        });
      }
    }

    return errors;
  }
}

/**
 * Parse pytest test results
 */
export function parsePytestResults(output: string): TestResults | undefined {
  const lines = output.split('\n');
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let duration = 0;

  // Pytest summary: "5 passed, 2 failed, 1 skipped in 0.34s"
  const summaryRegex = /(\d+)\s*passed,?\s*(\d+)\s*failed,?\s*(\d+)\s*(?:skipped|error)?,?\s*(\d+)\s*(?:error)?\s*in\s*([\d.]+)s?/i;

  for (const line of lines) {
    const match = summaryRegex.exec(line);
    if (match) {
      passed = parseInt(match[1], 10) || 0;
      failed = parseInt(match[2], 10) || 0;
      skipped = parseInt(match[3], 10) || 0;
      const errorCount = parseInt(match[4], 10) || 0;
      total = passed + failed + skipped + errorCount;
      duration = parseFloat(match[5]) * 1000 || 0;
      break;
    }
  }

  return {
    total,
    passed,
    failed,
    skipped,
    duration: Math.round(duration),
    suites: []
  };
}
