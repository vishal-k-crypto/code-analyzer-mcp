/**
 * Tests for SemanticCodeAnalyzer
 * Verifies that gap detection uses AST-based semantic analysis instead of simple string matching
 */

import { describe, it, expect } from 'vitest';
import { SemanticCodeAnalyzer } from '../semantic-analyzer.js';
import type { SourceFile } from '../../../types/gap.js';

describe('SemanticCodeAnalyzer', () => {
  const analyzer = new SemanticCodeAnalyzer();

  describe('analyzeComponent', () => {
    it('should detect class definitions with high confidence', () => {
      const file: SourceFile = {
        path: 'auth.ts',
        content: `
          export class UserAuth {
            constructor(private apiKey: string) {}
            
            authenticate() {
              return true;
            }
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['UserAuth'],
        hasSyntaxErrors: false
      };

      const result = analyzer.analyzeComponent(file, 'UserAuth');
      
      expect(result.found).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.matchType).toBe('definition');
      expect(result.locations.length).toBeGreaterThan(0);
    });

    it('should detect function definitions', () => {
      const file: SourceFile = {
        path: 'utils.ts',
        content: `
          export function validateUser(input: string): boolean {
            return input.length > 0;
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['validateUser'],
        hasSyntaxErrors: false
      };

      const result = analyzer.analyzeComponent(file, 'validateUser');
      
      expect(result.found).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.matchType).toBe('definition');
    });

    it('should detect interface definitions', () => {
      const file: SourceFile = {
        path: 'types.ts',
        content: `
          export interface UserProfile {
            id: string;
            name: string;
            email: string;
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['UserProfile'],
        hasSyntaxErrors: false
      };

      const result = analyzer.analyzeComponent(file, 'UserProfile');
      
      expect(result.found).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.matchType).toBe('definition');
    });

    it('should NOT detect components only mentioned in comments', () => {
      const file: SourceFile = {
        path: 'todo.ts',
        content: `
          // TODO: Implement UserAuth component
          // UserAuth should handle authentication
          
          /* 
           * We need to create PaymentGateway
           * PaymentGateway will process payments
           */
          
          export class SomeOtherClass {
            // This class does something else
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['SomeOtherClass'],
        hasSyntaxErrors: false
      };

      const userAuthResult = analyzer.analyzeComponent(file, 'UserAuth');
      const paymentGatewayResult = analyzer.analyzeComponent(file, 'PaymentGateway');
      
      // Should not be found or have very low confidence (only in comments)
      expect(userAuthResult.found).toBe(false);
      expect(userAuthResult.confidence).toBeLessThan(0.3);
      
      expect(paymentGatewayResult.found).toBe(false);
      expect(paymentGatewayResult.confidence).toBeLessThan(0.3);
    });

    it('should NOT detect components only in string literals', () => {
      const file: SourceFile = {
        path: 'messages.ts',
        content: `
          const ERROR_MESSAGES = {
            USER_NOT_FOUND: "UserAuth failed: user not found",
            INVALID_TOKEN: "UserAuth failed: invalid token"
          };
          
          export function getErrorMessage(key: string): string {
            return ERROR_MESSAGES[key as keyof typeof ERROR_MESSAGES] || "Unknown error";
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['getErrorMessage'],
        hasSyntaxErrors: false
      };

      const result = analyzer.analyzeComponent(file, 'UserAuth');
      
      // Should not be found as an implementation (only in strings)
      expect(result.found).toBe(false);
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('should detect type alias definitions', () => {
      const file: SourceFile = {
        path: 'types.ts',
        content: `
          export type ApiResponse<T> = {
            data: T;
            status: number;
            message: string;
          };
        `,
        language: 'typescript',
        imports: [],
        exports: ['ApiResponse'],
        hasSyntaxErrors: false
      };

      const result = analyzer.analyzeComponent(file, 'ApiResponse');
      
      expect(result.found).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should detect enum definitions', () => {
      const file: SourceFile = {
        path: 'enums.ts',
        content: `
          export enum UserRole {
            Admin = 'admin',
            User = 'user',
            Guest = 'guest'
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['UserRole'],
        hasSyntaxErrors: false
      };

      const result = analyzer.analyzeComponent(file, 'UserRole');
      
      expect(result.found).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should detect variable declarations', () => {
      const file: SourceFile = {
        path: 'config.ts',
        content: `
          export const APP_CONFIG = {
            apiUrl: 'https://api.example.com',
            timeout: 5000
          };
        `,
        language: 'typescript',
        imports: [],
        exports: ['APP_CONFIG'],
        hasSyntaxErrors: false
      };

      const result = analyzer.analyzeComponent(file, 'APP_CONFIG');
      
      expect(result.found).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should distinguish between definition and reference', () => {
      const file: SourceFile = {
        path: 'user-service.ts',
        content: `
          import { UserAuth } from './auth';
          
          export class UserService {
            private auth: UserAuth;
            
            constructor() {
              this.auth = new UserAuth('api-key');
            }
          }
        `,
        language: 'typescript',
        imports: ['./auth'],
        exports: ['UserService'],
        hasSyntaxErrors: false
      };

      const userAuthResult = analyzer.analyzeComponent(file, 'UserAuth');
      const userServiceResult = analyzer.analyzeComponent(file, 'UserService');
      
      // UserAuth is referenced but not defined here
      expect(userAuthResult.found).toBe(true); // It's a reference
      expect(userAuthResult.matchType).toBe('reference');
      
      // UserService is defined here
      expect(userServiceResult.found).toBe(true);
      expect(userServiceResult.matchType).toBe('definition');
      expect(userServiceResult.confidence).toBe(1.0);
    });
  });

  describe('extractDefinitions', () => {
    it('should extract all definitions from a file', () => {
      const file: SourceFile = {
        path: 'api.ts',
        content: `
          export interface ApiClient {
            get(url: string): Promise<any>;
            post(url: string, data: any): Promise<any>;
          }
          
          export class HttpClient implements ApiClient {
            async get(url: string) {
              return fetch(url);
            }
            
            async post(url: string, data: any) {
              return fetch(url, { method: 'POST', body: JSON.stringify(data) });
            }
          }
          
          export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
          
          export const DEFAULT_TIMEOUT = 30000;
          
          export enum StatusCode {
            OK = 200,
            NotFound = 404,
            Error = 500
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['ApiClient', 'HttpClient', 'HttpMethod', 'DEFAULT_TIMEOUT', 'StatusCode'],
        hasSyntaxErrors: false
      };

      const definitions = analyzer.extractDefinitions(file);
      
      const names = definitions.map(d => d.name);
      expect(names).toContain('ApiClient');
      expect(names).toContain('HttpClient');
      expect(names).toContain('HttpMethod');
      expect(names).toContain('DEFAULT_TIMEOUT');
      expect(names).toContain('StatusCode');
      
      // Check types
      expect(definitions.find(d => d.name === 'ApiClient')?.type).toBe('interface');
      expect(definitions.find(d => d.name === 'HttpClient')?.type).toBe('class');
      expect(definitions.find(d => d.name === 'HttpMethod')?.type).toBe('type');
      expect(definitions.find(d => d.name === 'DEFAULT_TIMEOUT')?.type).toBe('variable');
      expect(definitions.find(d => d.name === 'StatusCode')?.type).toBe('enum');
    });

    it('should identify exported vs non-exported definitions', () => {
      const file: SourceFile = {
        path: 'helpers.ts',
        content: `
          class InternalHelper {
            doSomething() {}
          }
          
          export class PublicHelper {
            doSomethingElse() {}
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['PublicHelper'],
        hasSyntaxErrors: false
      };

      const definitions = analyzer.extractDefinitions(file);
      
      const internal = definitions.find(d => d.name === 'InternalHelper');
      const public_ = definitions.find(d => d.name === 'PublicHelper');
      
      expect(internal?.isExported).toBe(false);
      expect(public_?.isExported).toBe(true);
    });
  });

  describe('hasDefinition', () => {
    it('should return true when component is defined in file', () => {
      const file: SourceFile = {
        path: 'store.ts',
        content: `
          export class DataStore {
            private data = new Map();
            
            get(key: string) {
              return this.data.get(key);
            }
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['DataStore'],
        hasSyntaxErrors: false
      };

      expect(analyzer.hasDefinition(file, 'DataStore')).toBe(true);
      expect(analyzer.hasDefinition(file, 'NonExistent')).toBe(false);
    });
  });

  describe('Python fallback analysis', () => {
    it('should detect Python class definitions', () => {
      const file: SourceFile = {
        path: 'models.py',
        content: `
class UserModel:
    def __init__(self, name):
        self.name = name
    
    def save(self):
        pass

def validate_user(data):
    return True
`,
        language: 'python',
        imports: [],
        exports: ['UserModel', 'validate_user'],
        hasSyntaxErrors: false
      };

      const result = analyzer.analyzeComponent(file, 'UserModel');
      
      expect(result.found).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect Python function definitions', () => {
      const file: SourceFile = {
        path: 'utils.py',
        content: `
def process_data(input_data):
    return input_data.strip()

def validate_input(data):
    return len(data) > 0
`,
        language: 'python',
        imports: [],
        exports: ['process_data', 'validate_input'],
        hasSyntaxErrors: false
      };

      const result = analyzer.analyzeComponent(file, 'process_data');
      
      expect(result.found).toBe(true);
    });
  });

  describe('Real-world scenario: Gap Analysis accuracy', () => {
    it('should not be fooled by TODO comments mentioning components', () => {
      const file: SourceFile = {
        path: 'payment.ts',
        content: `
          // TODO: Implement PaymentGateway
          // TODO: Add StripePaymentProvider
          // FIXME: PaymentGateway validation is missing
          
          export class PaymentController {
            // Controller implementation
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['PaymentController'],
        hasSyntaxErrors: false
      };

      const paymentGatewayResult = analyzer.analyzeComponent(file, 'PaymentGateway');
      const stripeResult = analyzer.analyzeComponent(file, 'StripePaymentProvider');
      
      // These should NOT be detected as implemented
      expect(paymentGatewayResult.found).toBe(false);
      expect(stripeResult.found).toBe(false);
      expect(paymentGatewayResult.confidence).toBeLessThan(0.3);
    });

    it('should correctly identify actually implemented components', () => {
      const file: SourceFile = {
        path: 'payment.ts',
        content: `
          export interface PaymentProvider {
            process(amount: number): Promise<boolean>;
          }
          
          export class StripePaymentProvider implements PaymentProvider {
            async process(amount: number): Promise<boolean> {
              // Actual implementation
              return true;
            }
          }
          
          export class PaymentGateway {
            constructor(private provider: PaymentProvider) {}
            
            async charge(amount: number) {
              return this.provider.process(amount);
            }
          }
        `,
        language: 'typescript',
        imports: [],
        exports: ['PaymentProvider', 'StripePaymentProvider', 'PaymentGateway'],
        hasSyntaxErrors: false
      };

      const providerResult = analyzer.analyzeComponent(file, 'PaymentProvider');
      const stripeResult = analyzer.analyzeComponent(file, 'StripePaymentProvider');
      const gatewayResult = analyzer.analyzeComponent(file, 'PaymentGateway');
      
      // These SHOULD be detected as implemented
      expect(providerResult.found).toBe(true);
      expect(stripeResult.found).toBe(true);
      expect(gatewayResult.found).toBe(true);
      
      expect(providerResult.confidence).toBe(1.0);
      expect(stripeResult.confidence).toBe(1.0);
      expect(gatewayResult.confidence).toBe(1.0);
    });
  });
});
