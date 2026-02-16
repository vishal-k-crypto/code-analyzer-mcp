/**
 * Rust Error Parser
 * Parses cargo and Rust-related errors
 */

import { ErrorParser } from './base.js';
import type { ParsedError } from '../../../types/score.js';

export class RustErrorParser extends ErrorParser {
  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');
    
    // Match: --> file.rs:line:col
    const arrowRegex = /^\s*-->\s+(.+):(\d+):(\d+)$/;
    // Match: error|warning: message
    const msgRegex = /^(error|warning)(?:\[E(\d+)\])?:\s*(.+)$/;

    for (let i = 0; i < lines.length; i++) {
      const arrowMatch = arrowRegex.exec(lines[i]);
      if (arrowMatch && i > 0) {
        const prevLine = lines[i - 1];
        const msgMatch = msgRegex.exec(prevLine);
        
        if (msgMatch) {
          errors.push({
            type: msgMatch[1] === 'error' ? 'syntax' : 'lint',
            severity: msgMatch[1] as 'error' | 'warning',
            file: arrowMatch[1],
            line: parseInt(arrowMatch[2], 10),
            column: parseInt(arrowMatch[3], 10),
            message: msgMatch[3],
            code: msgMatch[2] ? `E${msgMatch[2]}` : '',
            context: this.extractContext(lines, i)
          });
        }
      }
    }

    return errors;
  }
}
