/**
 * Execution Sandbox
 * Handles command execution with Docker containerization for security isolation
 * 
 * Security: All commands are executed inside Docker containers to prevent
 * host machine compromise from malicious code (e.g., rm -rf /)
 * 
 * Isolation Strategy: "Copy-in, execution, copy-out" - Files are copied to a 
 * temporary directory before execution, ensuring the sandbox only has access
 * to explicitly provided files, not the entire project.
 */

import { spawn } from 'child_process';
import { promises as fs, mkdtempSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import type { ExecutionResult, SandboxOptions, DockerConfig, ParsedError, TestResults, LintResults, TypeCheckResults } from '../../types/score.js';

/** Default Docker images for different project types */
const DEFAULT_IMAGES: Record<string, string> = {
  node: 'node:20-alpine',
  python: 'python:3.11-alpine',
  rust: 'rust:latest',
  go: 'golang:1.22-alpine',
  java: 'maven:3.9-eclipse-temurin-21-alpine',
  default: 'node:20-alpine'
};



export class ExecutionSandbox {
  private projectPath: string;
  private defaultTimeout: number;
  private defaultMaxMemory: number;
  private dockerConfig: DockerConfig;

  constructor(
    projectPath: string, 
    defaultTimeout = 60000, 
    defaultMaxMemory = 512,
    dockerConfig?: Partial<DockerConfig>
  ) {
    this.projectPath = projectPath;
    this.defaultTimeout = defaultTimeout;
    this.defaultMaxMemory = defaultMaxMemory;
    
    // Default Docker configuration with security options
    this.dockerConfig = {
      image: dockerConfig?.image || DEFAULT_IMAGES.default,
      enabled: dockerConfig?.enabled !== false, // Enabled by default
      extraOptions: dockerConfig?.extraOptions ?? [
        '--network=none',           // No network access for security
        '--read-only',              // Read-only root filesystem
        '--tmpfs=/tmp:noexec,nosuid,size=100m',  // Temp directory in memory
        '--cap-drop=ALL',           // Drop all capabilities
        '--security-opt=no-new-privileges:true' // Prevent privilege escalation
      ],
      containerWorkingDir: dockerConfig?.containerWorkingDir || '/app'
    };
  }

  /**
   * Create a temporary sandbox directory with isolated file copies
   * This implements the "copy-in" part of the copy-in/execution/copy-out strategy
   */
  private async createSandboxDirectory(
    inputFiles?: string[],
    inputDirectories?: string[]
  ): Promise<{ sandboxPath: string; cleanup: () => Promise<void> }> {
    // Create a unique temporary directory for this execution
    const sandboxPath = mkdtempSync(join(tmpdir(), 'orchestrator-sandbox-'));
    
    const filesToCopy: string[] = [];
    const dirsToCopy: string[] = [];

    // Collect files from explicit file list
    if (inputFiles && inputFiles.length > 0) {
      for (const file of inputFiles) {
        const sourcePath = join(this.projectPath, file);
        try {
          const stat = await fs.stat(sourcePath);
          if (stat.isFile()) {
            filesToCopy.push(file);
          } else if (stat.isDirectory()) {
            dirsToCopy.push(file);
          }
        } catch (err) {
          // File doesn't exist, skip it (it might be an output file that will be created)
        }
      }
    }

    // Collect files from directory patterns
    if (inputDirectories && inputDirectories.length > 0) {
      dirsToCopy.push(...inputDirectories);
    }

    // Copy individual files
    for (const file of filesToCopy) {
      const sourcePath = join(this.projectPath, file);
      const targetPath = join(sandboxPath, file);
      
      // Ensure parent directory exists
      await fs.mkdir(dirname(targetPath), { recursive: true });
      
      // Copy file content
      const content = await fs.readFile(sourcePath);
      await fs.writeFile(targetPath, content);
    }

    // Copy directories recursively
    const copyDir = async (source: string, target: string) => {
      await fs.mkdir(target, { recursive: true });
      const entries = await fs.readdir(source, { withFileTypes: true });
      
      for (const entry of entries) {
        const sourceEntry = join(source, entry.name);
        const targetEntry = join(target, entry.name);
        
        if (entry.isDirectory()) {
          await copyDir(sourceEntry, targetEntry);
        } else {
          const content = await fs.readFile(sourceEntry);
          await fs.writeFile(targetEntry, content);
        }
      }
    };

    for (const dir of dirsToCopy) {
      const sourcePath = join(this.projectPath, dir);
      const targetPath = join(sandboxPath, dir);
      try {
        await copyDir(sourcePath, targetPath);
      } catch (err) {
        // Directory might not exist, skip
      }
    }

    // Return cleanup function
    const cleanup = async () => {
      try {
        await fs.rm(sandboxPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    };

    return { sandboxPath, cleanup };
  }

  // NOTE: copyArtifactsFromSandbox method removed for now.
  // It can be added back when we implement full output artifact support.
  // The infrastructure for "copy-out" is prepared via the artifacts array in ExecutionResult.

  /**
   * Build Docker run arguments for sandboxed execution
   */
  private buildDockerArgs(
    command: string, 
    args: string[], 
    options: Partial<SandboxOptions>,
    sandboxPath?: string
  ): { dockerCommand: string; dockerArgs: string[] } {
    const image = options.docker?.image || this.dockerConfig.image;
    const containerWorkDir = options.docker?.containerWorkingDir || this.dockerConfig.containerWorkingDir || '/app';
    const extraOptions = options.docker?.extraOptions || this.dockerConfig.extraOptions || [];
    const maxMemory = options.maxMemory || this.defaultMaxMemory;

    // Use sandbox path if provided (isolated), otherwise fall back to project path (legacy behavior)
    // SECURITY: sandboxPath should always be used for true isolation
    const mountSource = sandboxPath || this.projectPath;

    // Build Docker run arguments
    const dockerArgs: string[] = [
      'run',
      '--rm',  // Remove container after execution
      '-v', `${mountSource}:${containerWorkDir}`,  // Mount sandbox directory (isolated)
      '-w', containerWorkDir,  // Set working directory
      '--memory', `${maxMemory}m`,  // Memory limit
      '--memory-swap', `${maxMemory}m`,  // No swap
      '--cpus', '1.0',  // CPU limit
      ...extraOptions
    ];

    // Add environment variables
    if (options.environment) {
      for (const [key, value] of Object.entries(options.environment)) {
        dockerArgs.push('-e', `${key}=${value}`);
      }
    }

    // Add timeout as a hard limit via Docker's timeout
    const timeout = options.timeout || this.defaultTimeout;
    dockerArgs.push('--stop-timeout', String(Math.ceil(timeout / 1000)));

    // Add image and command
    dockerArgs.push(image);
    dockerArgs.push(command);
    dockerArgs.push(...args);

    return { dockerCommand: 'docker', dockerArgs };
  }

  /**
   * Execute a command with output capture
   * Commands are automatically wrapped in Docker for security isolation
   * 
   * SECURITY: Uses "copy-in, execution, copy-out" strategy for true isolation.
   * Only specified input files are available to the sandboxed process.
   */
  async execute(
    command: string,
    args: string[] = [],
    options: Partial<SandboxOptions> = {}
  ): Promise<ExecutionResult> {
    // Check if Docker is disabled for this execution
    const dockerEnabled = options.docker?.enabled !== false && this.dockerConfig.enabled;

    let spawnCommand: string;
    let spawnArgs: string[];
    let workingDir: string;
    let cleanupSandbox: (() => Promise<void>) | undefined;
    let sandboxPath: string | undefined;

    if (dockerEnabled) {
      // SECURITY: Create isolated sandbox with copy-in strategy
      // This prevents the sandboxed process from accessing the entire project
      const sandbox = await this.createSandboxDirectory(
        options.inputFiles,
        options.inputDirectories
      );
      sandboxPath = sandbox.sandboxPath;
      cleanupSandbox = sandbox.cleanup;

      // Wrap command in Docker with isolated sandbox directory
      const dockerConfig = this.buildDockerArgs(command, args, options, sandboxPath);
      spawnCommand = dockerConfig.dockerCommand;
      spawnArgs = dockerConfig.dockerArgs;
      workingDir = process.cwd(); // Docker handles the working dir internally
    } else {
      // Run directly on host (backward compatibility, not recommended for security)
      spawnCommand = command;
      spawnArgs = args;
      workingDir = options.workingDirectory || this.projectPath;
    }

    const timeout = options.timeout || this.defaultTimeout;
    const env = dockerEnabled ? process.env : { ...process.env, ...options.environment };

    return new Promise((resolve) => {
      const startTime = Date.now();

      const child = spawn(spawnCommand, spawnArgs, {
        cwd: workingDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Capture stdout
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Limit captured output to 1MB
        if (stdout.length > 1024 * 1024) {
          stdout = stdout.slice(-1024 * 1024);
        }
      });

      // Capture stderr
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        // Limit captured output to 1MB
        if (stderr.length > 1024 * 1024) {
          stderr = stderr.slice(-1024 * 1024);
        }
      });

      // Timeout handling
      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        // Force kill after 5 seconds
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeout);

      child.on('close', async (code) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        // Parse results based on command type
        const output = stdout.trim() + '\n' + stderr.trim();
        const parsedErrors = this.parseErrorsFromOutput(command, output);
        const testResults = this.parseTestResults(command, output);
        const lintResults = this.parseLintResults(command, output);
        const typeResults = this.parseTypeResults(command, output);

        // Copy-out: Copy artifacts from sandbox back to project if needed
        let artifacts: string[] = [];
        if (dockerEnabled && sandboxPath) {
          // For now, we don't auto-detect output files - they'd need to be specified
          // This could be extended with an outputFiles option
          artifacts = []; 
        }

        // Cleanup: Remove temporary sandbox directory
        if (cleanupSandbox) {
          await cleanupSandbox();
        }

        resolve({
          success: code === 0 && !killed,
          exitCode: code || (killed ? -1 : 0),
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration,
          artifacts,
          parsedErrors,
          testResults,
          lintResults,
          typeResults
        });
      });

      child.on('error', async (error) => {
        clearTimeout(timeoutId);
        
        // Cleanup on error too
        if (cleanupSandbox) {
          await cleanupSandbox();
        }
        
        resolve({
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: error.message,
          duration: Date.now() - startTime,
          artifacts: [],
          parsedErrors: [],
          testResults: undefined,
          lintResults: undefined,
          typeResults: undefined
        });
      });
    });
  }

  /**
   * Execute multiple commands in sequence
   */
  async executeMultiple(
    commands: string[],
    options: Partial<SandboxOptions> = {}
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    
    for (const cmd of commands) {
      const [command, ...args] = cmd.split(' ');
      const result = await this.execute(command, args, options);
      results.push(result);
      
      // Stop on first failure if specified
      if (!result.success && options.workingDirectory) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute targeted tests based on modified files.
   * Uses the dependency graph to identify and run only relevant tests.
   * 
   * @param modifiedFiles - Array of file paths that were modified
   * @param contextAssembler - Optional ContextAssembler to find related tests
   * @returns Test execution results
   */
  async executeTargetedTests(
    modifiedFiles: string[],
    contextAssembler?: import('../context-injector/assembler.js').ContextAssembler
  ): Promise<{ results: ExecutionResult[]; targeted: boolean; testFiles: string[] }> {
    let testFiles: string[] = [];
    let commands: string[] = [];
    let targeted = false;

    // If we have a context assembler, use it to find related tests
    if (contextAssembler) {
      testFiles = contextAssembler.getRelatedTestFiles(modifiedFiles);
      
      if (testFiles.length > 0) {
        // Get base verification commands with test filtering
        commands = await this.detectVerificationCommands(testFiles);
        targeted = true;
      }
    }

    // If no targeted tests found or no context assembler, fall back to full suite
    if (!targeted || commands.length === 0) {
      commands = await this.detectVerificationCommands();
    }

    // Execute only test commands (filter out build/lint/typecheck)
    const testCommands = commands.filter(cmd => 
      this.isTestCommand(cmd) || cmd.includes('npm test') || cmd.includes('pytest')
    );

    const results: ExecutionResult[] = [];
    for (const cmd of testCommands) {
      const [command, ...args] = cmd.split(' ');
      const result = await this.execute(command, args, { timeout: 120000 });
      results.push(result);
    }

    return { results, targeted, testFiles };
  }

  /**
   * Check if a command is a test command
   */
  private isTestCommand(cmd: string): boolean {
    const testPatterns = ['test', 'jest', 'vitest', 'mocha', 'pytest', 'cargo test', 'go test'];
    return testPatterns.some(pattern => cmd.toLowerCase().includes(pattern.toLowerCase()));
  }

  /**
   * Detect project type and return appropriate verification commands
   * @param testFilter - Optional test file paths to run only specific tests
   */
  async detectVerificationCommands(testFilter?: string[]): Promise<string[]> {
    const files: string[] = await fs.readdir(this.projectPath).catch(() => []);

    // TypeScript/JavaScript
    if (files.includes('package.json')) {
      const packageJson = await fs.readFile(join(this.projectPath, 'package.json'), 'utf-8')
        .then(c => JSON.parse(c))
        .catch(() => ({}));

      const commands: string[] = [];

      if (files.includes('tsconfig.json')) {
        commands.push('npx tsc --noEmit');
      }

      if (packageJson.scripts) {
        if (packageJson.scripts.build) commands.push('npm run build');
        if (packageJson.scripts.test) {
          // Apply test filter if provided
          if (testFilter && testFilter.length > 0) {
            const filteredCommand = this.buildFilteredTestCommand(packageJson.scripts.test, testFilter, 'node');
            commands.push(filteredCommand);
          } else {
            commands.push('npm test');
          }
        }
        if (packageJson.scripts.lint) commands.push('npm run lint');
      }

      if (commands.length > 0) return commands;
      return testFilter && testFilter.length > 0 
        ? [`npm test -- --findRelatedTests ${testFilter.join(' ')}`]
        : ['npm install', 'npm test'];
    }

    // Python
    if (files.includes('pyproject.toml') || files.includes('requirements.txt')) {
      const commands: string[] = [];
      
      if (files.includes('pyproject.toml')) {
        // Apply test filter if provided
        if (testFilter && testFilter.length > 0) {
          commands.push(`python -m pytest ${testFilter.join(' ')}`);
        } else {
          commands.push('python -m pytest');
        }
        // Check for mypy in pyproject.toml or requirements
        const hasMyPy = await this.commandExists('mypy');
        if (hasMyPy) commands.push('mypy .');
      } else {
        if (testFilter && testFilter.length > 0) {
          commands.push(`pytest ${testFilter.join(' ')}`);
        } else {
          commands.push('pytest');
        }
      }

      return commands;
    }

    // Rust
    if (files.includes('Cargo.toml')) {
      // Rust test filtering is complex, typically uses module names
      // For now, run full suite if filter is provided but can't be easily applied
      return ['cargo build', 'cargo test'];
    }

    // Go
    if (files.includes('go.mod')) {
      if (testFilter && testFilter.length > 0) {
        // Extract unique directories from test files
        const testDirs = new Set<string>();
        for (const testPath of testFilter) {
          const dir = testPath.substring(0, testPath.lastIndexOf('/'));
          if (dir) testDirs.add(dir);
        }
        const dirPaths = Array.from(testDirs).join(' ');
        return ['go build ./...', `go test ${dirPaths} -v`];
      }
      return ['go build ./...', 'go test ./...'];
    }

    // Java
    if (files.includes('pom.xml')) {
      // Maven test filtering requires class names, which are hard to extract from file paths
      // without parsing the Java files
      return ['mvn compile', 'mvn test'];
    }

    // Default
    return [];
  }

  /**
   * Build a filtered test command based on the test runner and filter paths
   */
  private buildFilteredTestCommand(baseScript: string, testFilter: string[], projectType: string): string {
    // Jest supports --findRelatedTests for JS/TS projects
    if (projectType === 'node') {
      // Check if it's likely Jest/Vitest based on the script content
      if (baseScript.includes('jest') || baseScript.includes('vitest')) {
        return `npm test -- --findRelatedTests ${testFilter.join(' ')}`;
      }
      // Generic npm test with filter
      return `npm test -- ${testFilter.join(' ')}`;
    }
    
    return 'npm test';
  }

  /**
   * Detect the appropriate Docker image based on project type
   */
  async detectDockerImage(): Promise<string> {
    const files: string[] = await fs.readdir(this.projectPath).catch(() => []);

    if (files.includes('package.json')) {
      return DEFAULT_IMAGES.node;
    }
    if (files.includes('pyproject.toml') || files.includes('requirements.txt')) {
      return DEFAULT_IMAGES.python;
    }
    if (files.includes('Cargo.toml')) {
      return DEFAULT_IMAGES.rust;
    }
    if (files.includes('go.mod')) {
      return DEFAULT_IMAGES.go;
    }
    if (files.includes('pom.xml')) {
      return DEFAULT_IMAGES.java;
    }
    return DEFAULT_IMAGES.default;
  }

  /**
   * Update the Docker image for this sandbox instance
   */
  setDockerImage(image: string): void {
    this.dockerConfig.image = image;
  }

  /**
   * Get the current Docker configuration
   */
  getDockerConfig(): DockerConfig {
    return { ...this.dockerConfig };
  }

  /**
   * Check if a command exists
   * Note: When Docker is enabled, this checks inside the container
   */
  private async commandExists(command: string): Promise<boolean> {
    const checkCmd = this.dockerConfig.enabled 
      ? { command: 'docker', args: ['run', '--rm', this.dockerConfig.image, 'which', command] }
      : { 
          command: process.platform === 'win32' ? 'where' : 'which', 
          args: [command] 
        };

    const result = await this.execute(
      checkCmd.command,
      checkCmd.args,
      { timeout: 5000, maxMemory: 64, workingDirectory: this.projectPath, environment: {} }
    );
    return result.success;
  }

  /**
   * Parse errors from command output (public API for external use)
   */
  parseErrors(command: string, output: string): ParsedError[] {
    const parsers: Record<string, ErrorParser> = {
      'tsc': new TypeScriptErrorParser(),
      'eslint': new ESLintErrorParser(),
      'pytest': new PytestErrorParser(),
      'cargo': new CargoErrorParser(),
      'go': new GoErrorParser(),
      'mvn': new MavenErrorParser()
    };

    const parser = Object.entries(parsers).find(([key]) => command.includes(key))?.[1];
    
    if (parser) {
      return parser.parse(output);
    }

    return [];
  }

  /**
   * Internal method to parse errors from combined output
   */
  private parseErrorsFromOutput(command: string, output: string): ParsedError[] {
    return this.parseErrors(command, output);
  }

  /**
   * Parse test results from command output
   */
  private parseTestResults(command: string, output: string): TestResults | undefined {
    // Only parse test commands
    if (!command.includes('test') && !command.includes('jest') && !command.includes('pytest') && !command.includes('vitest')) {
      return undefined;
    }

    // Jest/Vitest parsing (npm test)
    if (command.includes('npm') || command.includes('jest') || command.includes('vitest')) {
      return this.parseJestResults(output);
    }

    // Pytest parsing
    if (command.includes('pytest') || command.includes('python')) {
      return this.parsePytestResults(output);
    }

    return undefined;
  }

  /**
   * Parse Jest/Vitest test results
   */
  private parseJestResults(output: string): TestResults | undefined {
    const lines = output.split('\n');
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let duration = 0;

    // Try to find Jest summary line: "Tests: 5 passed, 2 failed, 1 skipped, 8 total"
    // Or: "Tests:       5 passed, 2 failed, 1 skipped, 8 total (123 ms)"
    const testSummaryRegex = /Tests:\s*(\d+)\s*passed,?\s*(\d+)\s*failed,?\s*(\d+)\s*(?:pending|skipped)?,?\s*(\d+)\s*total/i;
    
    // Time format: "Time:        2.345 s" or "(1234 ms)"
    const timeRegex = /Time:\s*([\d.]+)\s*s|(?:\((\d+)\s*ms\))/i;

    for (const line of lines) {
      // Parse test counts
      const testMatch = testSummaryRegex.exec(line);
      if (testMatch) {
        passed = parseInt(testMatch[1], 10) || 0;
        failed = parseInt(testMatch[2], 10) || 0;
        skipped = parseInt(testMatch[3], 10) || 0;
        total = parseInt(testMatch[4], 10) || 0;
      }

      // Parse duration
      const timeMatch = timeRegex.exec(line);
      if (timeMatch) {
        if (timeMatch[1]) {
          duration = parseFloat(timeMatch[1]) * 1000; // Convert seconds to ms
        } else if (timeMatch[2]) {
          duration = parseInt(timeMatch[2], 10);
        }
      }
    }

    // If no explicit summary found, try counting individual test results
    if (total === 0) {
      const passMatch = output.match(/✓|✔|PASS|passed/g);
      const failMatch = output.match(/✕|✖|FAIL|failed/g);
      
      if (passMatch || failMatch) {
        passed = passMatch ? passMatch.length : 0;
        failed = failMatch ? failMatch.length : 0;
        total = passed + failed + skipped;
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

  /**
   * Parse Pytest results
   */
  private parsePytestResults(output: string): TestResults | undefined {
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

  /**
   * Parse lint results from command output
   */
  private parseLintResults(command: string, output: string): LintResults | undefined {
    // Only parse lint commands
    if (!command.includes('lint') && !command.includes('eslint')) {
      return undefined;
    }

    // ESLint JSON parsing
    if (command.includes('eslint')) {
      return this.parseESLintResults(output);
    }

    return undefined;
  }

  /**
   * Parse ESLint JSON output
   */
  private parseESLintResults(output: string): LintResults | undefined {
    try {
      // Try to parse JSON output from eslint --format json
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
      // Fallback to regex parsing if JSON parsing fails
      return this.parseESLintTextResults(output);
    }
  }

  /**
   * Parse ESLint text output as fallback
   */
  private parseESLintTextResults(output: string): LintResults {
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

  /**
   * Parse type check results from command output
   */
  private parseTypeResults(command: string, output: string): TypeCheckResults | undefined {
    // Only parse TypeScript commands
    if (!command.includes('tsc') && !command.includes('typescript')) {
      return undefined;
    }

    const lines = output.split('\n');
    const files = [];
    const seenFiles = new Set<string>();

    // Match TypeScript errors: "file.ts(line,col): error TSxxxx: message"
    const errorRegex = /^(.+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/;

    for (const line of lines) {
      const match = errorRegex.exec(line);
      if (match) {
        const filePath = match[1].trim();
        if (!seenFiles.has(filePath)) {
          seenFiles.add(filePath);
        }
        files.push({
          path: filePath,
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          message: match[5],
          code: match[4]
        });
      }
    }

    const errorCount = files.length;
    const totalFiles = seenFiles.size;

    return {
      totalFiles,
      errorCount,
      errorRate: totalFiles > 0 ? errorCount / totalFiles : 0,
      files
    };
  }
}

// Error Parser Classes
abstract class ErrorParser {
  abstract parse(output: string): ParsedError[];

  protected extractContext(lines: string[], lineIndex: number, context = 2): string {
    const start = Math.max(0, lineIndex - context);
    const end = Math.min(lines.length, lineIndex + context + 1);
    return lines.slice(start, end).join('\n');
  }
}

class TypeScriptErrorParser extends ErrorParser {
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

class ESLintErrorParser extends ErrorParser {
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

class PytestErrorParser extends ErrorParser {
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

class CargoErrorParser extends ErrorParser {
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

class GoErrorParser extends ErrorParser {
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

class MavenErrorParser extends ErrorParser {
  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');
    
    // Match: [ERROR] /path/File.java:[line,col] message
    const regex = /^\[ERROR\]\s+(.+):\[(\d+),(\d+)\]\s+(.+)$/;

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

// Re-export DockerConfig for convenience
export { DockerConfig, DEFAULT_IMAGES };
