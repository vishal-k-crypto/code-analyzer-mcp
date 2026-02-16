/**
 * Quality Heuristics
 * Configurable quality rules and heuristic-based scoring
 */

import type { LintResults, TypeCheckResults } from '../../types/score.js';

export interface QualityHeuristicConfig {
  // Lint thresholds
  lint: {
    maxErrorRate: number;        // Maximum acceptable error rate (0.02 = 2%)
    maxWarningRate: number;      // Maximum acceptable warning rate
    errorPenaltyWeight: number;  // How much each error deducts from score
    warningPenaltyWeight: number; // How much each warning deducts from score
  };
  
  // Type check thresholds
  typeCheck: {
    maxErrorRate: number;        // Maximum acceptable type error rate
    errorPenaltyWeight: number;  // How much each type error deducts
    strictMode: boolean;         // Whether to require zero type errors
  };
  
  // Test thresholds
  test: {
    minPassRate: number;         // Minimum test pass rate (0.90 = 90%)
    minCoverage: number;         // Minimum code coverage (optional)
  };
  
  // Recurring error penalties
  penalties: {
    recurringErrorThreshold: number;  // Number of occurrences to count as recurring
    recurringErrorPenalty: number;    // Score penalty for recurring errors
    criticalBugPenalty: number;       // Score penalty for critical bugs
  };
}

export const DEFAULT_HEURISTIC_CONFIG: QualityHeuristicConfig = {
  lint: {
    maxErrorRate: 0.02,
    maxWarningRate: 0.10,
    errorPenaltyWeight: 0.05,
    warningPenaltyWeight: 0.01
  },
  typeCheck: {
    maxErrorRate: 0.00,
    errorPenaltyWeight: 0.05,
    strictMode: true
  },
  test: {
    minPassRate: 0.90,
    minCoverage: 0.80
  },
  penalties: {
    recurringErrorThreshold: 3,
    recurringErrorPenalty: 5,
    criticalBugPenalty: 10
  }
};

export interface QualityScore {
  overall: number;
  lint: number;
  typeCheck: number;
  details: {
    lintPassed: boolean;
    typeCheckPassed: boolean;
    issues: QualityIssue[];
  };
}

export interface QualityIssue {
  type: 'lint' | 'type' | 'test' | 'general';
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
}

export class QualityHeuristics {
  private config: QualityHeuristicConfig;

  constructor(config?: Partial<QualityHeuristicConfig>) {
    this.config = {
      ...DEFAULT_HEURISTIC_CONFIG,
      ...config,
      lint: { ...DEFAULT_HEURISTIC_CONFIG.lint, ...config?.lint },
      typeCheck: { ...DEFAULT_HEURISTIC_CONFIG.typeCheck, ...config?.typeCheck },
      test: { ...DEFAULT_HEURISTIC_CONFIG.test, ...config?.test },
      penalties: { ...DEFAULT_HEURISTIC_CONFIG.penalties, ...config?.penalties }
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): QualityHeuristicConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QualityHeuristicConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      lint: { ...this.config.lint, ...config.lint },
      typeCheck: { ...this.config.typeCheck, ...config.typeCheck },
      test: { ...this.config.test, ...config.test },
      penalties: { ...this.config.penalties, ...config.penalties }
    };
  }

  /**
   * Calculate quality score from lint and type check results
   */
  calculateQualityScore(
    lintResults?: LintResults,
    typeResults?: TypeCheckResults,
    totalFiles: number = 1
  ): QualityScore {
    const issues: QualityIssue[] = [];
    
    // Calculate lint score
    let lintScore = 1.0;
    let lintPassed = true;
    
    if (lintResults) {
      const errorRate = lintResults.errorRate;
      
      lintPassed = errorRate <= this.config.lint.maxErrorRate;
      
      if (!lintPassed) {
        issues.push({
          type: 'lint',
          severity: 'error',
          message: `Lint error rate (${(errorRate * 100).toFixed(1)}%) exceeds threshold (${(this.config.lint.maxErrorRate * 100).toFixed(1)}%)`
        });
      }
      
      // Calculate score based on issues
      lintScore = Math.max(0, 
        1.0 - 
        (lintResults.errorCount * this.config.lint.errorPenaltyWeight) -
        (lintResults.warningCount * this.config.lint.warningPenaltyWeight / totalFiles)
      );
    }

    // Calculate type check score
    let typeScore = 1.0;
    let typeCheckPassed = true;
    
    if (typeResults) {
      const errorRate = typeResults.errorRate;
      
      typeCheckPassed = this.config.typeCheck.strictMode 
        ? errorRate === 0 
        : errorRate <= this.config.typeCheck.maxErrorRate;
      
      if (!typeCheckPassed) {
        issues.push({
          type: 'type',
          severity: 'error',
          message: `Type error rate (${(errorRate * 100).toFixed(1)}%) exceeds threshold (${(this.config.typeCheck.maxErrorRate * 100).toFixed(1)}%)`
        });
      }
      
      typeScore = Math.max(0, 
        1.0 - (typeResults.errorCount * this.config.typeCheck.errorPenaltyWeight)
      );
    }

    // Overall score is average of lint and type scores
    const overall = (lintScore + typeScore) / 2;

    return {
      overall,
      lint: lintScore,
      typeCheck: typeScore,
      details: {
        lintPassed,
        typeCheckPassed,
        issues
      }
    };
  }

  /**
   * Check if test pass rate meets minimum threshold
   */
  checkTestPassRate(passed: number, total: number): { passed: boolean; score: number } {
    const passRate = total > 0 ? passed / total : 0;
    return {
      passed: passRate >= this.config.test.minPassRate,
      score: passRate
    };
  }

  /**
   * Calculate penalty for recurring errors
   */
  calculateRecurringErrorPenalty(recurringErrorCount: number): number {
    if (recurringErrorCount === 0) return 0;
    return this.config.penalties.recurringErrorPenalty;
  }

  /**
   * Calculate penalty for critical bugs
   */
  calculateCriticalBugPenalty(criticalBugCount: number): number {
    return criticalBugCount * this.config.penalties.criticalBugPenalty;
  }

  /**
   * Validate if quality meets threshold
   */
  validateQuality(
    qualityScore: QualityScore,
    testPassRate: number
  ): { valid: boolean; violations: string[] } {
    const violations: string[] = [];

    if (!qualityScore.details.lintPassed) {
      violations.push('Lint errors exceed threshold');
    }

    if (!qualityScore.details.typeCheckPassed) {
      violations.push('Type errors exceed threshold');
    }

    if (testPassRate < this.config.test.minPassRate) {
      violations.push(`Test pass rate (${(testPassRate * 100).toFixed(1)}%) below minimum (${(this.config.test.minPassRate * 100).toFixed(1)}%)`);
    }

    return {
      valid: violations.length === 0,
      violations
    };
  }

  /**
   * Generate quality report
   */
  generateQualityReport(
    qualityScore: QualityScore,
    testResults: { passed: number; total: number },
    recurringErrors: number = 0,
    criticalBugs: number = 0
  ): string {
    const lines: string[] = [];
    
    lines.push('Quality Report');
    lines.push('==============');
    lines.push('');
    
    // Overall score
    lines.push(`Overall Quality Score: ${(qualityScore.overall * 100).toFixed(1)}%`);
    lines.push('');
    
    // Lint
    lines.push(`Lint Score: ${(qualityScore.lint * 100).toFixed(1)}% ${qualityScore.details.lintPassed ? '✓' : '✗'}`);
    lines.push(`  Threshold: ${(this.config.lint.maxErrorRate * 100).toFixed(1)}% max error rate`);
    lines.push('');
    
    // Type Check
    lines.push(`Type Check Score: ${(qualityScore.typeCheck * 100).toFixed(1)}% ${qualityScore.details.typeCheckPassed ? '✓' : '✗'}`);
    lines.push(`  Threshold: ${this.config.typeCheck.strictMode ? '0' : (this.config.typeCheck.maxErrorRate * 100).toFixed(1) + '%'} max error rate`);
    lines.push('');
    
    // Tests
    const testPassRate = testResults.total > 0 ? testResults.passed / testResults.total : 0;
    const testPassed = testPassRate >= this.config.test.minPassRate;
    lines.push(`Test Pass Rate: ${(testPassRate * 100).toFixed(1)}% ${testPassed ? '✓' : '✗'}`);
    lines.push(`  Threshold: ${(this.config.test.minPassRate * 100).toFixed(1)}% minimum`);
    lines.push('');
    
    // Penalties
    if (recurringErrors > 0) {
      const penalty = this.calculateRecurringErrorPenalty(recurringErrors);
      lines.push(`Recurring Error Penalty: -${penalty} (${recurringErrors} patterns)`);
    }
    
    if (criticalBugs > 0) {
      const penalty = this.calculateCriticalBugPenalty(criticalBugs);
      lines.push(`Critical Bug Penalty: -${penalty} (${criticalBugs} bugs)`);
    }
    
    // Issues
    if (qualityScore.details.issues.length > 0) {
      lines.push('');
      lines.push('Issues:');
      for (const issue of qualityScore.details.issues) {
        const icon = issue.severity === 'error' ? '✗' : '⚠';
        lines.push(`  ${icon} [${issue.type}] ${issue.message}`);
      }
    }
    
    return lines.join('\n');
  }
}
