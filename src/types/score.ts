/**
 * Scoring Engine Types
 * Type definitions for project scoring and quality metrics
 */

export interface TestResults {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  suites: TestSuite[];
}

export interface TestSuite {
  name: string;
  tests: TestCase[];
}

export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
}

export interface LintResults {
  totalFiles: number;
  errorCount: number;
  warningCount: number;
  errorRate: number;
  files: LintFile[];
}

export interface LintFile {
  path: string;
  errors: LintIssue[];
}

export interface LintIssue {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
  rule: string;
}

export interface TypeCheckResults {
  totalFiles: number;
  errorCount: number;
  errorRate: number;
  files: TypeError[];
}

export interface TypeError {
  path: string;
  line: number;
  column: number;
  message: string;
  code: string;
}

export interface ExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  artifacts: string[];
  // Parsed results from output
  parsedErrors?: ParsedError[];
  testResults?: TestResults;
  lintResults?: LintResults;
  typeResults?: TypeCheckResults;
}

export interface DockerConfig {
  /** Docker image to use (e.g., 'node:20', 'python:3.11', 'rust:latest') */
  image: string;
  /** Whether to enable Docker sandboxing (default: true) */
  enabled?: boolean;
  /** Additional Docker run options (e.g., ['--network=none']) */
  extraOptions?: string[];
  /** Working directory inside the container (default: '/app') */
  containerWorkingDir?: string;
}

export interface SandboxOptions {
  timeout: number;
  maxMemory: number;
  workingDirectory: string;
  environment: Record<string, string>;
  /** Docker-specific configuration for this execution */
  docker?: Partial<DockerConfig>;
  /** 
   * Files to copy into the sandbox for isolated execution.
   * If specified, these files will be copied to a temp directory instead of mounting the entire project.
   * This provides true isolation - the sandbox can only access these specific files.
   * @example ['src/index.ts', 'package.json', 'tsconfig.json']
   */
  inputFiles?: string[];
  /**
   * Directory patterns to copy into the sandbox (e.g., ['src/', 'lib/']).
   * These are relative to the project path.
   */
  inputDirectories?: string[];
}

export interface ParsedError {
  type: 'syntax' | 'type' | 'runtime' | 'test' | 'lint';
  severity: 'error' | 'warning';
  file: string;
  line: number;
  column: number;
  message: string;
  code: string;
  context: string;
}

export interface ProgressAnalysis {
  trend: 'improving' | 'stable' | 'regressing';
  velocity: number;
  estimatedCompletion: Date | null;
}
