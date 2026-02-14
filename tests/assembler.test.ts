/**
 * Tests for Context Assembler
 * Verifies semantic matching, AST-based analysis, and relevance scoring
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextAssembler } from '../src/subsystems/context-injector/assembler.js';
import type { Task, ProjectGoal } from '../src/types/state.js';

// Mock fs and glob
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
      access: vi.fn(),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
    }
  };
});

vi.mock('glob', () => ({
  glob: vi.fn()
}));

import { promises as fs } from 'fs';
import { glob } from 'glob';

describe('ContextAssembler', () => {
  let assembler: ContextAssembler;
  const mockProjectPath = '/test/project';

  beforeEach(() => {
    assembler = new ContextAssembler(mockProjectPath);
    vi.clearAllMocks();
  });

  describe('Semantic Matching', () => {
    it('should match "authentication" task with "login.ts" file via concept expansion', async () => {
      // Setup mock files - login.ts doesn't contain word "authentication"
      const mockFiles = [
        {
          path: '/test/project/src/auth/login.ts',
          content: `
            export class LoginController {
              async handleLogin(username: string, password: string) {
                // Validate credentials
                const session = await this.createSession(username);
                return { token: session.jwt };
              }
              
              private async createSession(user: string) {
                return { jwt: 'token123', user };
              }
            }
          `
        },
        {
          path: '/test/project/src/utils/helpers.ts',
          content: `
            export function formatDate(date: Date) {
              return date.toISOString();
            }
          `
        }
      ];

      vi.mocked(glob).mockResolvedValue(mockFiles.map(f => f.path) as unknown as string[]);
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        const file = mockFiles.find(f => f.path === path);
        return file ? file.content : '';
      });

      // Build index
      await assembler.buildFileIndex();

      // Create task about "authentication" - not "login"
      const task: Task = {
        id: 'test-1',
        phase: 1,
        title: 'Fix authentication flow',
        description: 'Update the authentication mechanism to use JWT tokens properly',
        acceptanceCriteria: ['JWT tokens are validated', 'Sessions are created correctly'],
        context: {
          relevantFiles: [],
          forbiddenFiles: [],
          instructions: '',
          expectedOutput: 'Updated authentication'
        },
        verificationCommands: [],
        status: 'pending',
        attempts: 0,
        createdAt: new Date(),
        completedAt: null
      };

      const relevance = assembler.calculateFileRelevance(task);
      
      // login.ts should be highly relevant despite not containing "authentication"
      const loginFile = relevance.find(r => r.path.includes('login.ts'));
      const helperFile = relevance.find(r => r.path.includes('helpers.ts'));

      expect(loginFile).toBeDefined();
      expect(helperFile).toBeDefined();
      
      // login.ts should have higher relevance due to semantic concept matching
      // (login <-> authentication are in the same concept cluster)
      expect(loginFile!.score).toBeGreaterThan(helperFile!.score);
      expect(loginFile!.signals.semanticMatch).toBeGreaterThan(0.1);
    });

    it('should match "security" task with files containing encryption/hashing code', async () => {
      const mockFiles = [
        {
          path: '/test/project/src/crypto/hash.ts',
          content: `
            import crypto from 'crypto';
            
            export function hashPassword(password: string, salt: string): string {
              return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
            }
            
            export function generateSalt(): string {
              return crypto.randomBytes(16).toString('hex');
            }
          `
        },
        {
          path: '/test/project/src/api/users.ts',
          content: `
            export function getUsers() {
              return [{ id: 1, name: 'John' }];
            }
          `
        }
      ];

      vi.mocked(glob).mockResolvedValue(mockFiles.map(f => f.path) as unknown as string[]);
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        const file = mockFiles.find(f => f.path === path);
        return file ? file.content : '';
      });

      await assembler.buildFileIndex();

      const task: Task = {
        id: 'test-2',
        phase: 1,
        title: 'Improve security',
        description: 'Enhance security by implementing better password hashing',
        acceptanceCriteria: ['Passwords are hashed securely'],
        context: {
          relevantFiles: [],
          forbiddenFiles: [],
          instructions: '',
          expectedOutput: 'Secure hashing'
        },
        verificationCommands: [],
        status: 'pending',
        attempts: 0,
        createdAt: new Date(),
        completedAt: null
      };

      const relevance = assembler.calculateFileRelevance(task);
      
      const hashFile = relevance.find(r => r.path.includes('hash.ts'));
      const usersFile = relevance.find(r => r.path.includes('users.ts'));

      expect(hashFile).toBeDefined();
      expect(usersFile).toBeDefined();
      
      // hash.ts should be more relevant due to semantic concept mapping
      // (security -> hash, encrypt)
      expect(hashFile!.score).toBeGreaterThan(usersFile!.score);
    });

    it('should use structural analysis to match task with exported functions', async () => {
      const mockFiles = [
        {
          path: '/test/project/src/validators/user.ts',
          content: `
            /**
             * Validates user input for authentication forms
             */
            export function validateUserInput(data: unknown) {
              // validation logic
            }
            
            export class UserValidator {
              validateEmail(email: string) {
                return email.includes('@');
              }
            }
          `
        },
        {
          path: '/test/project/src/random/other.ts',
          content: `
            export function doSomething() {
              return 42;
            }
          `
        }
      ];

      vi.mocked(glob).mockResolvedValue(mockFiles.map(f => f.path) as unknown as string[]);
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        const file = mockFiles.find(f => f.path === path);
        return file ? file.content : '';
      });

      await assembler.buildFileIndex();

      const task: Task = {
        id: 'test-3',
        phase: 1,
        title: 'Fix user validation',
        description: 'Update the user validation logic to handle edge cases',
        acceptanceCriteria: ['Validation handles edge cases'],
        context: {
          relevantFiles: [],
          forbiddenFiles: [],
          instructions: '',
          expectedOutput: 'Fixed validation'
        },
        verificationCommands: [],
        status: 'pending',
        attempts: 0,
        createdAt: new Date(),
        completedAt: null
      };

      const relevance = assembler.calculateFileRelevance(task);
      
      const validatorFile = relevance.find(r => r.path.includes('user.ts'));
      const otherFile = relevance.find(r => r.path.includes('other.ts'));

      expect(validatorFile).toBeDefined();
      expect(otherFile).toBeDefined();
      
      // User validator file should be more relevant due to exported function/class names
      expect(validatorFile!.score).toBeGreaterThan(otherFile!.score);
    });
  });

  describe('TF-IDF Calculation', () => {
    it('should give higher scores to unique terms in rare documents', async () => {
      const mockFiles = [
        {
          path: '/test/project/src/common/utils.ts',
          content: `
            export function helper() { return 'common'; }
            export function util() { return 'common'; }
            export function common() { return 'common'; }
          `
        },
        {
          path: '/test/project/src/common/helpers.ts',
          content: `
            export function helper() { return 'common'; }
            export function util() { return 'common'; }
            export function common() { return 'common'; }
          `
        },
        {
          path: '/test/project/src/special/oauth.ts',
          content: `
            export function oauthLogin() { return 'special'; }
            export function oauthCallback() { return 'special'; }
          `
        }
      ];

      vi.mocked(glob).mockResolvedValue(mockFiles.map(f => f.path) as unknown as string[]);
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        const file = mockFiles.find(f => f.path === path);
        return file ? file.content : '';
      });

      await assembler.buildFileIndex();

      const task: Task = {
        id: 'test-4',
        phase: 1,
        title: 'Implement OAuth',
        description: 'Add OAuth authentication support',
        acceptanceCriteria: ['OAuth works'],
        context: {
          relevantFiles: [],
          forbiddenFiles: [],
          instructions: '',
          expectedOutput: 'OAuth'
        },
        verificationCommands: [],
        status: 'pending',
        attempts: 0,
        createdAt: new Date(),
        completedAt: null
      };

      const relevance = assembler.calculateFileRelevance(task);
      
      const oauthFile = relevance.find(r => r.path.includes('oauth.ts'));
      
      expect(oauthFile).toBeDefined();
      // oauth.ts should have good semantic match due to unique "oauth" term
      expect(oauthFile!.signals.semanticMatch).toBeGreaterThan(0.2);
    });
  });

  describe('Lexical vs Semantic Matching', () => {
    it('should find files with semantic similarity even without exact keyword matches', async () => {
      const mockFiles = [
        {
          path: '/test/project/src/auth/session.ts',
          content: `
            export class SessionManager {
              private sessions = new Map();
              
              createSession(userId: string) {
                const token = this.generateToken();
                this.sessions.set(token, { userId, created: Date.now() });
                return token;
              }
              
              private generateToken() {
                return Math.random().toString(36).substring(2);
              }
            }
          `
        }
      ];

      vi.mocked(glob).mockResolvedValue(mockFiles.map(f => f.path) as unknown as string[]);
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        const file = mockFiles.find(f => f.path === path);
        return file ? file.content : '';
      });

      await assembler.buildFileIndex();

      // Task uses "authentication" but file only contains "session", "token", "user"
      const task: Task = {
        id: 'test-5',
        phase: 1,
        title: 'Fix authentication',
        description: 'The authentication system needs to be fixed',
        acceptanceCriteria: ['Auth works'],
        context: {
          relevantFiles: [],
          forbiddenFiles: [],
          instructions: '',
          expectedOutput: 'Fixed auth'
        },
        verificationCommands: [],
        status: 'pending',
        attempts: 0,
        createdAt: new Date(),
        completedAt: null
      };

      const relevance = assembler.calculateFileRelevance(task);
      const sessionFile = relevance.find(r => r.path.includes('session.ts'));

      expect(sessionFile).toBeDefined();
      // File should still have decent semantic match due to concept expansion
      // "authentication" -> "session", "token" are related concepts
      expect(sessionFile!.signals.semanticMatch).toBeGreaterThan(0.1);
    });
  });
});
