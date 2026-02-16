/**
 * ESLint Error Parser
 * Parses ESLint linting errors
 */

import { ErrorParser } from './base.js';
import type { ParsedError, LintResults } from '../../../types/score.js';

export class ESLintErrorParser extends ErrorParser {
  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');
    
    // Match: /path/to/file.ts
    //   line:col  severity  message  rule
    const fileRegex = /^(.+)$/;
    const errorRegex = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(.+)$/;

    let currentFile = '';

    for (let i = 0; i < lines.length; i++) {
      const fileMatch = fileRegex.exec(lines[i]);
      if (fileMatch && !fileMatch[1].startsWith(' ')) {
        currentFile = fileMatch[1].trim();
        continue;
      }

      const errorMatch = errorRegex.exec(lines[i]);
      if (errorMatch && currentFile) {
        errors.push({
          type: 'lint',
          severity: errorMatch[3] as 'error' | 'warning',
          file: currentFile,
          line: parseInt(errorMatch[1], 10),
          column: parseInt(errorMatch[2], 10),
          message: errorMatch[4].trim(),
          code: errorMatch[5].trim(),
          context: this.extractContext(lines, i)
        });
      }
    }

    return errors;
  }
}

/**
 * Parse ESLint JSON output
 */
export function parseESLintJson(output: string): LintResults | undefined {
  try {
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return undefined;

    const results = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(results)) return undefined;

    let errorCount = 0;
    let warningCount = 0;
    const files = [];

    for (const file of results) {
      if (file.messages && file.messages.length > 0) {
        const errors = [];
        for (const msg of file.messages) {
          if (msg.severity === 2) {
            errorCount++;
          } else if (msg.severity === 1) {
            warningCount++;
          }
          errors.push({
            line: msg.line || 0,
            column: msg.column || 0,
            severity: (msg.severity === 2 ? 'error' : 'warning') as 'error' | 'warning',
            message: msg.message || '',
            rule: msg.ruleId || ''
          });
        }
        files.push({
          path: file.filePath || '',
          errors
        });
      }
    }

    const totalFiles = results.length;
    const errorRate = totalFiles > 0 ? (errorCount + warningCount) / totalFiles : 0;

    return {
      totalFiles,
      errorCount,
      warningCount,
      errorRate,
      files
    };
  } catch {
    return undefined;
  }
}

/**
 * Parse ESLint text output as fallback
 */
export function parseESLintText(output: string): LintResults {
  const lines = output.split('\n');
  let errorCount = 0;
  let warningCount = 0;

  // Match: "✖ 5 problems (3 errors, 2 warnings)"
  const summaryRegex = /(\d+)\s*problems?\s*\((\d+)\s*errors?,?\s*(\d+)\s*warnings?\)/i;
  
  for (const line of lines) {
    const match = summaryRegex.exec(line);
    if (match) {
      errorCount = parseInt(match[2], 10) || 0;
      warningCount = parseInt(match[3], 10) || 0;
      break;
    }
  }

  return {
    totalFiles: 0,
    errorCount,
    warningCount,
    errorRate: 0,
    files: []
  };
}
