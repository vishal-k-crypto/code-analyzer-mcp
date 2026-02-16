/**
 * Go Error Parser
 * Parses go test and Go-related errors
 */

import { ErrorParser } from './base.js';
import type { ParsedError } from '../../../types/score.js';

export class GoErrorParser extends ErrorParser {
  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');
    
    // Match: file.go:line:col: message
    const regex = /^(.+\.go):(\d+):(\d+):\s*(.+)$/;

    for (let i = 0; i < lines.length; i++) {
      const match = regex.exec(lines[i]);
      if (match) {
        errors.push({
          type: 'syntax',
          severity: 'error',
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          message: match[4],
          code: '',
          context: this.extractContext(lines, i)
        });
      }
    }

    return errors;
  }
}
