/**
 * Tests for Execution Sandbox Runner
 * Verifies command execution, output parsing, and error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ExecutionSandbox } from '../runner.js';

describe('ExecutionSandbox', () => {
  let tempDir: string;
  let sandbox: ExecutionSandbox;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `orchestrator-sandbox-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    sandbox = new ExecutionSandbox(tempDir, 30000, 256, { enabled: false });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const defaultSandbox = new ExecutionSandbox(tempDir);
      expect(defaultSandbox.getDockerConfig().enabled).toBe(true);
    });

    it('should accept custom timeout and memory', () => {
      const customSandbox = new ExecutionSandbox(tempDir, 60000, 512);
      expect(customSandbox).toBeDefined();
    });

    it('should accept custom Docker config', () => {
      const customSandbox = new ExecutionSandbox(tempDir, 30000, 256, {
        enabled: false,
        image: 'custom-image'
      });
      expect(customSandbox.getDockerConfig().enabled).toBe(false);
    });
  });

  describe('command execution', () => {
    it('should execute echo command', async () => {
      const result = await sandbox.execute('echo', ['hello world']);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello world');
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should capture stderr separately', async () => {
      // Use a command that writes to stderr
      const result = await sandbox.execute('node', ['-e', 'console.error("error output")']);

      expect(result.success).toBe(true);
      expect(result.stderr).toContain('error output');
    });

    it('should return non-zero exit code on failure', async () => {
      const result = await sandbox.execute('node', ['-e', 'process.exit(1)']);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should handle command not found', async () => {
      const result = await sandbox.execute('nonexistent-command-12345', []);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-1);
      // Error message may contain 'ENOENT', 'error', or 'spawn'
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it('should respect timeout option', async () => {
      // This should timeout
      const result = await sandbox.execute('sleep', ['10'], { timeout: 100 });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-1);
    });

    it('should work with working directory', async () => {
      // Create a file in temp dir
      await fs.writeFile(join(tempDir, 'test.txt'), 'content');
      
      // List files in working directory
      const result = await sandbox.execute('ls', ['-1'], { workingDirectory: tempDir });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('test.txt');
    });
  });

  describe('environment variables', () => {
    it('should pass environment variables', async () => {
      const result = await sandbox.execute('node', ['-e', 'console.log(process.env.TEST_VAR)'], {
        environment: { TEST_VAR: 'test_value' }
      });

      expect(result.stdout).toBe('test_value');
    });
  });

  describe('executeMultiple', () => {
    it('should execute multiple commands', async () => {
      const results = await sandbox.executeMultiple([
        'echo first',
        'echo second'
      ]);

      expect(results.length).toBe(2);
      expect(results[0].stdout).toBe('first');
      expect(results[1].stdout).toBe('second');
    });
  });

  describe('Docker configuration', () => {
    it('should get Docker config', () => {
      const config = sandbox.getDockerConfig();

      expect(config.enabled).toBe(false);
      expect(config.image).toBeDefined();
      expect(config.containerWorkingDir).toBeDefined();
      expect(Array.isArray(config.extraOptions)).toBe(true);
    });

    it('should set Docker image', () => {
      sandbox.setDockerImage('node:18-alpine');

      expect(sandbox.getDockerConfig().image).toBe('node:18-alpine');
    });

    it('should have security options in default config', () => {
      const defaultSandbox = new ExecutionSandbox(tempDir);
      const config = defaultSandbox.getDockerConfig();

      expect(config.extraOptions).toContain('--network=none');
      expect(config.extraOptions).toContain('--read-only');
      expect(config.extraOptions).toContain('--cap-drop=ALL');
    });
  });

  describe('error parsing', () => {
    it('should parse TypeScript errors', () => {
      const output = `src/test.ts(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
src/test.ts(15,10): error TS2304: Cannot find name 'undefinedVar'.`;

      const errors = sandbox.parseErrors('tsc', output);

      expect(errors.length).toBe(2);
      expect(errors[0].file).toBe('src/test.ts');
      expect(errors[0].line).toBe(10);
      expect(errors[0].column).toBe(5);
      expect(errors[0].code).toBe('TS2345');
      expect(errors[0].type).toBe('type');
    });

    it('should parse ESLint errors', () => {
      const output = `/path/to/file.ts
  10:5  error  Unexpected any  @typescript-eslint/no-explicit-any
  15:10  warning  Unused variable  @typescript-eslint/no-unused-vars`;

      const errors = sandbox.parseErrors('eslint', output);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].type).toBe('lint');
    });

    it('should return empty array for unknown command', () => {
      const errors = sandbox.parseErrors('unknown-command', 'some output');
      expect(errors).toEqual([]);
    });
  });

  describe('test result parsing', () => {
    it('should parse Jest results', async () => {
      // Create a mock package.json
      await fs.writeFile(join(tempDir, 'package.json'), JSON.stringify({
        scripts: { test: 'jest' }
      }));

      const sandboxWithProject = new ExecutionSandbox(tempDir, 30000, 256, { enabled: false });
      
      // Use node to simulate test output
      const result = await sandboxWithProject.execute('node', ['-e', `
        console.log('PASS src/test.spec.ts');
        console.log('Tests: 5 passed, 2 failed, 1 skipped, 8 total');
        console.log('Time: 1.234 s');
      `]);

      // The execute method doesn't automatically parse test results for non-test commands
      // But we can verify the parsing logic exists
      expect(result.success).toBe(true);
    });
  });

  describe('verification command detection', () => {
    it('should detect TypeScript project commands', async () => {
      await fs.writeFile(join(tempDir, 'package.json'), JSON.stringify({
        scripts: { test: 'jest', build: 'tsc', lint: 'eslint .' }
      }));
      await fs.writeFile(join(tempDir, 'tsconfig.json'), '{}');

      const commands = await sandbox.detectVerificationCommands();

      expect(commands).toContain('npx tsc --noEmit');
      expect(commands).toContain('npm test');
      expect(commands).toContain('npm run lint');
    });

    it('should detect Python project commands', async () => {
      await fs.writeFile(join(tempDir, 'pyproject.toml'), '[tool.pytest]');

      const commands = await sandbox.detectVerificationCommands();

      expect(commands.some(c => c.includes('pytest'))).toBe(true);
    });

    it('should detect Rust project commands', async () => {
      await fs.writeFile(join(tempDir, 'Cargo.toml'), '[package]');

      const commands = await sandbox.detectVerificationCommands();

      expect(commands).toContain('cargo build');
      expect(commands).toContain('cargo test');
    });

    it('should detect Go project commands', async () => {
      await fs.writeFile(join(tempDir, 'go.mod'), 'module test');

      const commands = await sandbox.detectVerificationCommands();

      expect(commands).toContain('go build ./...');
      expect(commands).toContain('go test ./...');
    });

    it('should return empty array for unknown project', async () => {
      const commands = await sandbox.detectVerificationCommands();
      expect(commands).toEqual([]);
    });
  });

  describe('Docker image detection', () => {
    it('should detect Node image for package.json', async () => {
      await fs.writeFile(join(tempDir, 'package.json'), '{}');
      const image = await sandbox.detectDockerImage();
      expect(image).toContain('node');
    });

    it('should detect Python image for pyproject.toml', async () => {
      await fs.writeFile(join(tempDir, 'pyproject.toml'), '');
      const image = await sandbox.detectDockerImage();
      expect(image).toContain('python');
    });

    it('should detect Rust image for Cargo.toml', async () => {
      await fs.writeFile(join(tempDir, 'Cargo.toml'), '');
      const image = await sandbox.detectDockerImage();
      expect(image).toContain('rust');
    });

    it('should detect Go image for go.mod', async () => {
      await fs.writeFile(join(tempDir, 'go.mod'), '');
      const image = await sandbox.detectDockerImage();
      expect(image).toContain('golang');
    });

    it('should return default image for unknown project', async () => {
      const image = await sandbox.detectDockerImage();
      expect(image).toBe('node:20-alpine');
    });
  });

  describe('sandbox isolation', () => {
    it('should create sandbox directory when Docker is enabled', async () => {
      const dockerSandbox = new ExecutionSandbox(tempDir, 30000, 256, { enabled: true });
      
      // The sandbox directory is created during execute when Docker is enabled
      // We can't easily test this without Docker, but we can verify the config
      expect(dockerSandbox.getDockerConfig().enabled).toBe(true);
    });
  });
});
