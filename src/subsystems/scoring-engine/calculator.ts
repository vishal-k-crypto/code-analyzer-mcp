/**
 * Score Calculator
 * Calculates project completion score based on actual test/lint/typecheck execution
 * Supports targeted verification - running only tests related to changed files
 */

import type { 
  OrchestratorState, 
  ScoreBreakdown, 
  ScoreHistory, 
  ScoreEntry,
  ProgressAnalysis,
  Task
} from '../../types/state.js';
import type { TestResults } from '../../types/score.js';
import { ExecutionSandbox } from '../execution-sandbox/runner.js';
import { ContextAssembler } from '../context-injector/assembler.js';

export interface ScoreCalculatorOptions {
  projectPath: string;
  contextAssembler?: ContextAssembler;
  enableTargetedTesting?: boolean;
}

export class ScoreCalculator {
  private sandbox: ExecutionSandbox;
  private contextAssembler?: ContextAssembler;
  private enableTargetedTesting: boolean;

  constructor(options: ScoreCalculatorOptions) {
    this.sandbox = new ExecutionSandbox(options.projectPath);
    this.contextAssembler = options.contextAssembler;
    this.enableTargetedTesting = options.enableTargetedTesting ?? true;
  }

  /**
   * Calculate overall completion score
   * @param state - Current orchestrator state
   * @param modifiedFiles - Optional array of files modified in the last task (for targeted testing)
   */
  async calculateScore(
    state: OrchestratorState, 
    modifiedFiles?: string[]
  ): Promise<{ score: number; breakdown: ScoreBreakdown; testMetadata?: { targeted: boolean; testFiles: string[] } }> {
    let totalScore = 0;
    let maxPossible = 0;

    // Requirements Coverage (40%)
    const requirementsScore = this.calculateRequirementsCoverage(state);
    totalScore += requirementsScore * 40;
    maxPossible += 40;

    // Test Pass Rate (30%) - Actually runs tests (targeted if modifiedFiles provided)
    const { results: testResults, targeted, testFiles } = await this.runTests(modifiedFiles);
    const testScore = testResults.total > 0 
      ? testResults.passed / testResults.total 
      : 0;
    totalScore += testScore * 30;
    maxPossible += 30;

    // Code Quality (15%) - Actually runs linter and type checker
    const qualityScore = await this.calculateCodeQuality();
    totalScore += qualityScore * 15;
    maxPossible += 15;

    // Implementation Completeness (15%)
    const completenessScore = this.calculateCompleteness(state);
    totalScore += completenessScore * 15;
    maxPossible += 15;

    // Calculate final score
    let finalScore = maxPossible > 0 ? (totalScore / maxPossible) * 100 : 0;

    // Apply penalties
    const penalties = this.calculatePenalties(state);
    finalScore = Math.max(0, finalScore - penalties);

    const breakdown: ScoreBreakdown = {
      requirementsCoverage: requirementsScore * 40,
      testPassRate: testScore * 30,
      codeQuality: qualityScore * 15,
      implementationCompleteness: completenessScore * 15,
      penalties
    };

    return {
      score: Math.round(finalScore),
      breakdown,
      testMetadata: {
        targeted,
        testFiles
      }
    };
  }

  /**
   * Calculate requirements coverage
   */
  private calculateRequirementsCoverage(state: OrchestratorState): number {
    if (!state.projectGoal || state.projectGoal.requirements.length === 0) {
      return 0;
    }

    let covered = 0;
    let totalWeight = 0;

    for (const req of state.projectGoal.requirements) {
      totalWeight += req.weight || 1;
      if (req.verified) {
        covered += req.weight || 1;
      } else if (req.partiallyMet) {
        covered += (req.weight || 1) * 0.5;
      }
    }

    return totalWeight > 0 ? covered / totalWeight : 0;
  }

  /**
   * Run tests and collect actual results
   * Supports targeted testing - running only tests related to modified files
   * 
   * @param modifiedFiles - Optional array of files modified in the last task
   * @returns Test results along with metadata about whether targeting was used
   */
  private async runTests(modifiedFiles?: string[]): Promise<{ results: TestResults; targeted: boolean; testFiles: string[] }> {
    // If we have modified files and targeted testing is enabled, use targeted approach
    if (modifiedFiles && modifiedFiles.length > 0 && this.enableTargetedTesting && this.contextAssembler) {
      const { results, targeted, testFiles } = await this.sandbox.executeTargetedTests(
        modifiedFiles, 
        this.contextAssembler
      );

      if (targeted && results.length > 0) {
        // Aggregate results from targeted test execution
        let total = 0;
        let passed = 0;
        let failed = 0;
        let skipped = 0;
        let duration = 0;

        for (const result of results) {
          if (result.testResults) {
            total += result.testResults.total;
            passed += result.testResults.passed;
            failed += result.testResults.failed;
            skipped += result.testResults.skipped;
            duration += result.testResults.duration;
          }
        }

        return {
          results: {
            total,
            passed,
            failed,
            skipped,
            duration,
            suites: []
          },
          targeted: true,
          testFiles
        };
      }
    }

    // Fall back to running full test suite
    const commands = await this.sandbox.detectVerificationCommands();
    
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let duration = 0;

    for (const cmd of commands) {
      // Only run actual test commands, not build/lint/typecheck
      if (this.isTestCommand(cmd)) {
        const result = await this.executeTestCommand(cmd);
        total += result.total;
        passed += result.passed;
        failed += result.failed;
        skipped += result.skipped;
        duration += result.duration;
      }
    }

    // If no test commands were found/executed, return zeros
    return {
      results: {
        total,
        passed,
        failed,
        skipped,
        duration,
        suites: []
      },
      targeted: false,
      testFiles: []
    };
  }

  /**
   * Check if a command is a test command
   */
  private isTestCommand(cmd: string): boolean {
    const testPatterns = ['test', 'jest', 'vitest', 'mocha', 'pytest', 'cargo test', 'go test'];
    return testPatterns.some(pattern => cmd.toLowerCase().includes(pattern.toLowerCase()));
  }

  /**
   * Execute a test command and parse results
   */
  private async executeTestCommand(cmd: string): Promise<TestResults> {
    const [command, ...args] = cmd.split(' ');
    const result = await this.sandbox.execute(command, args, { timeout: 120000 });

    const output = result.stdout + '\n' + result.stderr;

    // Parse based on test runner type
    if (cmd.includes('vitest') || cmd.includes('jest')) {
      return this.parseVitestResults(output, result.duration);
    } else if (cmd.includes('mocha')) {
      return this.parseMochaResults(output, result.duration);
    } else if (cmd.includes('pytest')) {
      return this.parsePytestResults(output, result.duration);
    } else if (cmd.includes('cargo test')) {
      return this.parseCargoTestResults(output, result.duration);
    } else if (cmd.includes('go test')) {
      return this.parseGoTestResults(output, result.duration);
    } else if (cmd.includes('mvn test')) {
      return this.parseMavenTestResults(output, result.duration);
    }

    // Generic fallback - try to extract numbers from output
    return this.parseGenericTestResults(output, result.duration);
  }

  /**
   * Parse Vitest/Jest test results
   */
  private parseVitestResults(output: string, duration: number): TestResults {
    // Match patterns like: "Tests  15 passed (15)"
    const testsMatch = output.match(/Tests\s+(\d+) passed/);
    const failedMatch = output.match(/Tests\s+(\d+) failed/);
    const skippedMatch = output.match(/Tests\s+(\d+) skipped|skipped (\d+)/);

    const passed = testsMatch ? parseInt(testsMatch[1], 10) : 0;
    const failedCount = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    const skippedCount = skippedMatch ? parseInt(skippedMatch[1] || skippedMatch[2], 10) : 0;

    return {
      total: passed + failedCount + skippedCount,
      passed,
      failed: failedCount,
      skipped: skippedCount,
      duration,
      suites: []
    };
  }

  /**
   * Parse Mocha test results
   */
  private parseMochaResults(output: string, duration: number): TestResults {
    // Match: "15 passing (2s)" or "5 failing"
    const passingMatch = output.match(/(\d+) passing/);
    const failingMatch = output.match(/(\d+) failing/);
    const pendingMatch = output.match(/(\d+) pending/);

    const passed = passingMatch ? parseInt(passingMatch[1], 10) : 0;
    const failedCount = failingMatch ? parseInt(failingMatch[1], 10) : 0;
    const pending = pendingMatch ? parseInt(pendingMatch[1], 10) : 0;

    return {
      total: passed + failedCount + pending,
      passed,
      failed: failedCount,
      skipped: pending,
      duration,
      suites: []
    };
  }

  /**
   * Parse Pytest results
   */
  private parsePytestResults(output: string, duration: number): TestResults {
    // Match: "5 passed, 2 failed, 1 skipped in 0.5s"
    const summaryMatch = output.match(/(\d+) passed(?:, (\d+) failed)?(?:, (\d+) skipped)?(?:, (\d+) error)?/);
    
    if (summaryMatch) {
      const passed = parseInt(summaryMatch[1], 10) || 0;
      const failed = parseInt(summaryMatch[2], 10) || 0;
      const skipped = parseInt(summaryMatch[3], 10) || 0;
      const errors = parseInt(summaryMatch[4], 10) || 0;

      return {
        total: passed + failed + skipped + errors,
        passed,
        failed: failed + errors,
        skipped,
        duration,
        suites: []
      };
    }

    return this.parseGenericTestResults(output, duration);
  }

  /**
   * Parse Cargo test results
   */
  private parseCargoTestResults(output: string, duration: number): TestResults {
    // Match: "test result: ok. 5 passed; 0 failed; 0 ignored;"
    const resultMatch = output.match(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/);
    
    if (resultMatch) {
      const passed = parseInt(resultMatch[1], 10);
      const failed = parseInt(resultMatch[2], 10);
      const ignored = parseInt(resultMatch[3], 10);

      return {
        total: passed + failed + ignored,
        passed,
        failed,
        skipped: ignored,
        duration,
        suites: []
      };
    }

    return this.parseGenericTestResults(output, duration);
  }

  /**
   * Parse Go test results
   */
  private parseGoTestResults(output: string, duration: number): TestResults {
    const lines = output.split('\n');
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const line of lines) {
      // Match: "--- PASS: TestName (0.1s)"
      if (line.includes('--- PASS:')) passed++;
      // Match: "--- FAIL: TestName (0.1s)"
      else if (line.includes('--- FAIL:')) failed++;
      // Match: "--- SKIP: TestName (0.1s)"
      else if (line.includes('--- SKIP:')) skipped++;
    }

    // Also check for "PASS" or "FAIL" at the end
    const hasPass = output.includes('\nPASS\n') || output.endsWith('\nPASS');
    const hasFail = output.includes('\nFAIL\n') || output.endsWith('\nFAIL');

    // If no individual test results found but overall status exists
    if (passed === 0 && failed === 0 && (hasPass || hasFail)) {
      // Try to extract from "ok package_name 0.1s" format
      const okMatch = output.match(/^ok\s+\S+\s+([\d.]+)s?$/gm);
      if (okMatch) passed = okMatch.length;
    }

    return {
      total: passed + failed + skipped,
      passed,
      failed,
      skipped,
      duration,
      suites: []
    };
  }

  /**
   * Parse Maven test results
   */
  private parseMavenTestResults(output: string, duration: number): TestResults {
    // Match: "Tests run: 10, Failures: 2, Errors: 0, Skipped: 1"
    const match = output.match(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/);
    
    if (match) {
      const total = parseInt(match[1], 10);
      const failures = parseInt(match[2], 10);
      const errors = parseInt(match[3], 10);
      const skipped = parseInt(match[4], 10);

      return {
        total,
        passed: total - failures - errors - skipped,
        failed: failures + errors,
        skipped,
        duration,
        suites: []
      };
    }

    return this.parseGenericTestResults(output, duration);
  }

  /**
   * Parse generic test results as fallback
   */
  private parseGenericTestResults(output: string, duration: number): TestResults {
    // Try common patterns
    const passedMatch = output.match(/(\d+)\s+passed?/i);
    const failedMatch = output.match(/(\d+)\s+failed?/i);
    const skippedMatch = output.match(/(\d+)\s+(?:skipped?|ignored)/i);

    const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;

    return {
      total: passed + failed + skipped,
      passed,
      failed,
      skipped,
      duration,
      suites: []
    };
  }

  /**
   * Calculate code quality score based on actual lint and type check
   */
  private async calculateCodeQuality(): Promise<number> {
    const commands = await this.sandbox.detectVerificationCommands();

    let lintScore = 1.0; // Default to perfect if no linting
    let typeScore = 1.0; // Default to perfect if no type checking
    let hasLintCommand = false;
    let hasTypeCommand = false;

    for (const cmd of commands) {
      if (this.isLintCommand(cmd)) {
        hasLintCommand = true;
        lintScore = await this.executeLintCommand(cmd);
      } else if (this.isTypeCheckCommand(cmd)) {
        hasTypeCommand = true;
        typeScore = await this.executeTypeCheckCommand(cmd);
      }
    }

    // If we don't have lint/type commands, don't penalize
    const effectiveLintScore = hasLintCommand ? lintScore : 1.0;
    const effectiveTypeScore = hasTypeCommand ? typeScore : 1.0;

    return (effectiveLintScore + effectiveTypeScore) / 2;
  }

  /**
   * Check if a command is a lint command
   */
  private isLintCommand(cmd: string): boolean {
    const lintPatterns = ['eslint', 'lint', 'clippy', 'golint', 'pylint', 'flake8'];
    return lintPatterns.some(pattern => cmd.toLowerCase().includes(pattern.toLowerCase()));
  }

  /**
   * Check if a command is a type check command
   */
  private isTypeCheckCommand(cmd: string): boolean {
    const typePatterns = ['tsc', 'typecheck', 'mypy', 'type-check'];
    return typePatterns.some(pattern => cmd.toLowerCase().includes(pattern.toLowerCase()));
  }

  /**
   * Execute linter and calculate quality score
   */
  private async executeLintCommand(cmd: string): Promise<number> {
    const [command, ...args] = cmd.split(' ');
    const result = await this.sandbox.execute(command, args, { timeout: 120000 });

    const errors = this.sandbox.parseErrors(command, result.stdout + '\n' + result.stderr);
    
    // Count errors and warnings
    const errorCount = errors.filter(e => e.severity === 'error').length;
    const warningCount = errors.filter(e => e.severity === 'warning').length;

    // Calculate score: errors are worse than warnings
    // Base score of 1.0, deduct for issues
    // Each error: -0.05, each warning: -0.01
    // Minimum score: 0
    const score = Math.max(0, 1.0 - (errorCount * 0.05) - (warningCount * 0.01));

    return score;
  }

  /**
   * Execute type checker and calculate quality score
   */
  private async executeTypeCheckCommand(cmd: string): Promise<number> {
    const [command, ...args] = cmd.split(' ');
    const result = await this.sandbox.execute(command, args, { timeout: 120000 });

    // If type check passes (exit code 0), perfect score
    if (result.success && result.exitCode === 0) {
      return 1.0;
    }

    const errors = this.sandbox.parseErrors(command, result.stdout + '\n' + result.stderr);
    const errorCount = errors.length;

    // Each type error reduces score significantly
    // Type errors are more critical than lint warnings
    const score = Math.max(0, 1.0 - (errorCount * 0.05));

    return score;
  }

  /**
   * Calculate implementation completeness
   */
  private calculateCompleteness(state: OrchestratorState): number {
    // Collect all tasks from all phases
    const allTasks: Task[] = [];
    for (const phase of state.taskQueue.phases) {
      allTasks.push(...phase.tasks);
    }
    
    const completed = allTasks.filter(t => t.status === 'completed').length;
    const pending = allTasks.filter(t => t.status === 'pending').length;
    const failed = allTasks.filter(t => t.status === 'failed').length;
    const inProgress = allTasks.filter(t => t.status === 'in_progress').length;
    
    const total = pending + completed + failed + inProgress;

    if (total === 0) return 0;

    return completed / total;
  }

  /**
   * Calculate penalties
   */
  private calculatePenalties(state: OrchestratorState): number {
    let penalty = 0;

    // Recurring errors penalty
    const recurringErrors = state.errorLog.patterns.filter(p => p.frequency >= 3);
    if (recurringErrors.length > 0) {
      penalty += 5;
    }

    // Critical bugs penalty (would need actual bug detection)
    // penalty += 10;

    return penalty;
  }

  /**
   * Add score entry to history
   */
  addScoreEntry(
    history: ScoreHistory,
    score: number,
    breakdown: ScoreBreakdown,
    taskId: string
  ): ScoreHistory {
    const entry: ScoreEntry = {
      timestamp: new Date(),
      score,
      breakdown,
      taskCompleted: taskId
    };

    const newEntries = [...history.entries, entry];

    return {
      entries: newEntries,
      trend: this.calculateTrend(newEntries),
      velocity: this.calculateVelocity(newEntries)
    };
  }

  /**
   * Calculate trend from recent entries
   */
  private calculateTrend(entries: ScoreEntry[]): 'improving' | 'stable' | 'regressing' {
    if (entries.length < 3) return 'stable';

    const recent = entries.slice(-5);
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));

    const firstAvg = firstHalf.reduce((sum, e) => sum + e.score, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, e) => sum + e.score, 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;
    if (diff > 5) return 'improving';
    if (diff < -5) return 'regressing';
    return 'stable';
  }

  /**
   * Calculate velocity (points per entry)
   */
  private calculateVelocity(entries: ScoreEntry[]): number {
    if (entries.length < 2) return 0;

    const recent = entries.slice(-5);
    if (recent.length < 2) return 0;

    const scoreDiff = recent[recent.length - 1].score - recent[0].score;
    return scoreDiff / recent.length;
  }

  /**
   * Analyze progress and provide insights
   */
  analyzeProgress(history: ScoreHistory): ProgressAnalysis {
    const trend = history.trend;
    const velocity = history.velocity;

    // Estimate completion
    let estimatedCompletion: Date | null = null;
    
    if (history.entries.length > 0 && velocity > 0) {
      const currentScore = history.entries[history.entries.length - 1].score;
      const remaining = 85 - currentScore; // Target is 85
      
      if (remaining > 0) {
        const entriesNeeded = remaining / velocity;
        const daysNeeded = entriesNeeded * 0.5; // Assume 2 entries per day
        estimatedCompletion = new Date(Date.now() + daysNeeded * 24 * 60 * 60 * 1000);
      } else {
        estimatedCompletion = new Date();
      }
    }

    return {
      trend,
      velocity,
      estimatedCompletion
    };
  }
}
