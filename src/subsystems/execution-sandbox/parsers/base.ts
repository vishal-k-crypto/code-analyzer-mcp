/**
 * Base Error Parser
 * Abstract class for all error parsers
 */

import type { ParsedError } from '../../../types/score.js';

export abstract class ErrorParser {
  abstract parse(output: string): ParsedError[];

  protected extractContext(lines: string[], lineIndex: number, context = 2): string {
    const start = Math.max(0, lineIndex - context);
    const end = Math.min(lines.length, lineIndex + context + 1);
    return lines.slice(start, end).join('\n');
  }
}
