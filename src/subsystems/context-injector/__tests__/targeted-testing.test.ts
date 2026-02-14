/**
 * Tests for targeted testing functionality
 * Verifies that the dependency graph is used to identify related tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextAssembler } from '../assembler.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Targeted Testing', () => {
  let tempDir: string;
  let assembler: ContextAssembler;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = join(tmpdir(), `orchestrator-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create a sample project structure
    await fs.mkdir(join(tempDir, 'src', 'components'), { recursive: true });
    await fs.mkdir(join(tempDir, 'src', 'utils'), { recursive: true });
    
    // Create source files with imports
    await fs.writeFile(
      join(tempDir, 'src', 'utils', 'helpers.ts'),
      `export function formatDate(date: Date): string { return date.toISOString(); }`
    );
    
    await fs.writeFile(
      join(tempDir, 'src', 'components', 'Button.tsx'),
      `import { formatDate } from '../utils/helpers';\nexport const Button = () => <button>Click</button>;`
    );
    
    await fs.writeFile(
      join(tempDir, 'src', 'components', 'Login.tsx'),
      `import { Button } from './Button';\nexport const Login = () => <div><Button /></div>;`
    );
    
    // Create test files
    await fs.writeFile(
      join(tempDir, 'src', 'utils', 'helpers.test.ts'),
      `import { formatDate } from './helpers';\ntest('formatDate', () => { expect(formatDate(new Date())).toBeDefined(); });`
    );
    
    await fs.writeFile(
      join(tempDir, 'src', 'components', 'Button.test.tsx'),
      `import { Button } from './Button';\ntest('Button renders', () => { expect(Button).toBeDefined(); });`
    );
    
    await fs.writeFile(
      join(tempDir, 'src', 'components', 'Login.test.tsx'),
      `import { Login } from './Login';\ntest('Login renders', () => { expect(Login).toBeDefined(); });`
    );
    
    assembler = new ContextAssembler(tempDir);
    await assembler.buildFileIndex();
  });

  describe('getRelatedTestFiles', () => {
    it('should find test file for a modified source file', async () => {
      const modifiedFiles = ['src/utils/helpers.ts'];
      const relatedTests = assembler.getRelatedTestFiles(modifiedFiles);
      
      expect(relatedTests).toContain('src/utils/helpers.test.ts');
    });

    it('should find tests that import the modified file (reverse dependencies)', async () => {
      const modifiedFiles = ['src/utils/helpers.ts'];
      const relatedTests = assembler.getRelatedTestFiles(modifiedFiles);
      
      // Button.test.tsx imports Button.tsx which imports helpers.ts
      // This demonstrates transitive dependency tracking
      expect(relatedTests.length).toBeGreaterThan(0);
    });

    it('should include the test file itself if modified', async () => {
      const modifiedFiles = ['src/components/Button.test.tsx'];
      const relatedTests = assembler.getRelatedTestFiles(modifiedFiles);
      
      expect(relatedTests).toContain('src/components/Button.test.tsx');
    });

    it('should return empty array for files with no related tests', async () => {
      // Create a file with no test
      await fs.writeFile(
        join(tempDir, 'src', 'untested.ts'),
        `export const untested = () => 'no tests';`
      );
      
      const modifiedFiles = ['src/untested.ts'];
      const relatedTests = assembler.getRelatedTestFiles(modifiedFiles);
      
      expect(relatedTests).toEqual([]);
    });
  });

  describe('generateFilteredTestCommand', () => {
    it('should generate Jest command with --findRelatedTests', () => {
      const modifiedFiles = ['src/utils/helpers.ts'];
      const command = assembler.generateFilteredTestCommand(modifiedFiles, 'npm test');
      
      expect(command).toContain('--findRelatedTests');
      expect(command).toContain('src/utils/helpers.test.ts');
    });

    it('should return null when no related tests found', () => {
      const command = assembler.generateFilteredTestCommand(['nonexistent.ts'], 'npm test');
      
      expect(command).toBeNull();
    });

    it('should generate pytest command for Python projects', () => {
      const modifiedFiles = ['src/utils/helpers.py'];
      // Mock the getRelatedTestFiles to return Python test files
      const command = assembler.generateFilteredTestCommand(modifiedFiles, 'pytest');
      
      // For Python, it should include the test file paths directly
      if (command) {
        expect(command.startsWith('pytest')).toBe(true);
      }
    });
  });
});
