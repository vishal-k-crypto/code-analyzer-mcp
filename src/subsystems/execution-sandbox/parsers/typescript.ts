/**
 * TypeScript Error Parser
 * Parses tsc and TypeScript-related errors
 */

import { ErrorParser } from './base.js';
import type { ParsedError } from '../../../types/score.js';

export class TypeScriptErrorParser extends ErrorParser {
  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');
    
    // Match: file.ts(line,col): error TSxxxx: message
    const regex = /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

    for (let i = 0; i < lines.length; i++) {
      const match = regex.exec(lines[i]);
      if (match) {
        errors.push({
          type: match[4] === 'error' ? 'type' : 'lint',
          severity: match[4] as 'error' | 'warning',
          file: match[1].trim(),
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          message: match[6],
          code: match[5],
          context: this.extractContext(lines, i)
        });
      }
    }

    return errors;
  }
}
