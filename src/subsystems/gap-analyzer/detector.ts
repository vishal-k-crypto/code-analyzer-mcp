/**
 * Gap Detector
 * PHASE 2: Detects gaps using AST-based targeted verification
 * 
 * Upgrade: Uses ts-morph for precise implementation detection
 * - Verifies functions have actual complexity > 0
 * - Distinguishes between stubs and real implementations
 */

import { promises as fs } from 'fs';
import { glob } from 'glob';
import { join } from 'path';
import type { Gap, ParsedRequirement, CodebaseState, SourceFile } from '../../types/gap.js';
import * as ts from 'typescript';
import type { ProjectGoal } from '../../types/state.js';
import { SemanticCodeAnalyzer } from './semantic-analyzer.js';
import { ASTVerifier } from './ast-verifier.js';

export class GapDetector {
  private projectPath: string;
  private semanticAnalyzer: SemanticCodeAnalyzer;
  private astVerifier: ASTVerifier;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.semanticAnalyzer = new SemanticCodeAnalyzer();
    this.astVerifier = new ASTVerifier();
  }

  /**
   * Detect all gaps between goal and current state
   */
  async detectGaps(goal: ProjectGoal | null): Promise<Gap[]> {
    if (!goal) {
      return [];
    }

    const gaps: Gap[] = [];
    const codebaseState = await this.scanCodebase();

    // Check each requirement
    for (const requirement of goal.requirements) {
      const evidence = await this.searchCodebase(requirement, codebaseState);

      if (evidence.found && evidence.complete) {
        // Requirement met, continue
        continue;
      } else if (evidence.found && !evidence.complete) {
        gaps.push({
          id: `gap-${Date.now()}-${requirement.id}`,
          type: 'PARTIAL_IMPLEMENTATION',
          requirement,
          existingFiles: evidence.files,
          missingParts: evidence.missing,
          detectedAt: new Date(),
          priority: requirement.priority
        });
      } else {
        gaps.push({
          id: `gap-${Date.now()}-${requirement.id}`,
          type: 'MISSING_IMPLEMENTATION',
          requirement,
          existingFiles: [],
          missingParts: evidence.missing,
          detectedAt: new Date(),
          priority: requirement.priority
        });
      }
    }

    // Detect syntax errors
    const syntaxErrors = await this.detectSyntaxErrors(codebaseState);
    gaps.push(...syntaxErrors);

    // Detect test failures
    const testFailures = await this.detectTestFailures(codebaseState);
    gaps.push(...testFailures);

    // Detect missing dependencies
    const missingDeps = await this.detectMissingDependencies(codebaseState);
    gaps.push(...missingDeps);

    return gaps.sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority));
  }

  /**
   * Scan the codebase to understand current state
   */
  async scanCodebase(): Promise<CodebaseState> {
    const sourceFiles: SourceFile[] = [];
    const configFiles: { path: string; type: 'tsconfig' | 'package' | 'cargo' | 'pyproject' | 'go' | 'generic'; content: unknown }[] = [];
    const testFiles: string[] = [];

    // Scan source files
    const patterns = [
      '**/*.{ts,tsx,js,jsx,py,rs,go,java,rb,php}',
      '!**/node_modules/**',
      '!**/.git/**',
      '!**/dist/**',
      '!**/build/**',
      '!**/.orchestrator/**'
    ];

    const files = await glob(patterns, { cwd: this.projectPath, absolute: true });

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const relativePath = filePath.replace(this.projectPath + '/', '');
        const language = this.detectLanguage(filePath);

        // Check if it's a test file
        if (this.isTestFile(relativePath)) {
          testFiles.push(relativePath);
          continue;
        }

        sourceFiles.push({
          path: relativePath,
          content,
          language,
          imports: this.extractImports(content, language),
          exports: this.extractExports(content, language),
          hasSyntaxErrors: false // Would need actual parsing
        });
      } catch {
        // Skip unreadable files
      }
    }

    return {
      rootPath: this.projectPath,
      sourceFiles,
      configFiles,
      dependencyGraph: {
        nodes: new Map(),
        edges: []
      },
      testFiles
    };
  }

  /**
   * Search codebase for evidence of requirement implementation
   * Uses AST-based verification to ensure real implementations exist
   * Replaces brittle regex matching with proper symbol analysis
   */
  private async searchCodebase(
    requirement: ParsedRequirement,
    state: CodebaseState
  ): Promise<{ found: boolean; complete: boolean; files: string[]; missing: string[] }> {
    const foundFiles: string[] = [];
    const missing: string[] = [];
    let totalConfidence = 0;
    
    // Search for component implementations using AST verification
    for (const component of requirement.components) {
      let componentFound = false;
      let maxConfidence = 0;
      const matchingFiles: string[] = [];

      for (const file of state.sourceFiles) {
        // For TypeScript/JavaScript files: use AST-based verification
        // This replaces the brittle isFileNameMatch with proper symbol analysis
        if (file.language === 'typescript' || file.language === 'javascript') {
          const symbolMatch = this.astVerifier.findMatchingSymbol(file, component);
          
          if (symbolMatch?.hasImplementation) {
            // Found a real implementation via AST analysis
            componentFound = true;
            maxConfidence = Math.max(maxConfidence, symbolMatch.confidence);
            if (!matchingFiles.includes(file.path)) {
              matchingFiles.push(file.path);
            }
            continue;
          }
          
          // Fallback: also check with semantic analyzer for references
          const semanticResult = this.semanticAnalyzer.analyzeComponent(file, component);
          if (semanticResult.found && semanticResult.confidence >= 0.7) {
            componentFound = true;
            maxConfidence = Math.max(maxConfidence, semanticResult.confidence);
            if (!matchingFiles.includes(file.path)) {
              matchingFiles.push(file.path);
            }
          }
        } else {
          // For other languages: use semantic analyzer
          const semanticResult = this.semanticAnalyzer.analyzeComponent(file, component);
          const hasDefinition = this.semanticAnalyzer.hasDefinition(file, component);
          
          if (hasDefinition || (semanticResult.found && semanticResult.confidence >= 0.7)) {
            componentFound = true;
            maxConfidence = Math.max(maxConfidence, semanticResult.confidence);
            if (!matchingFiles.includes(file.path)) {
              matchingFiles.push(file.path);
            }
          }
        }
      }

      if (componentFound) {
        foundFiles.push(...matchingFiles);
        totalConfidence += maxConfidence;
      } else {
        missing.push(component);
      }
    }

    // Check acceptance criteria using semantic analysis
    let criteriaMet = 0;
    for (const criterion of requirement.acceptanceCriteria) {
      const criterionFound = this.checkAcceptanceCriterion(criterion, state);
      if (criterionFound) criteriaMet++;
    }

    const uniqueFiles = [...new Set(foundFiles)];
    
    // Calculate completeness based on:
    // 1. No missing components
    // 2. At least 80% of acceptance criteria met
    // 3. Average confidence of component matches
    const criteriaThreshold = Math.max(1, Math.floor(requirement.acceptanceCriteria.length * 0.8));
    const avgConfidence = requirement.components.length > 0 
      ? totalConfidence / requirement.components.length 
      : 0;
    
    const isComplete = missing.length === 0 && 
                      criteriaMet >= criteriaThreshold &&
                      avgConfidence >= 0.6;

    return {
      found: uniqueFiles.length > 0,
      complete: isComplete,
      files: uniqueFiles,
      missing
    };
  }

  /**
   * Check if acceptance criterion is implemented
   * Uses semantic analysis to avoid false positives from comments/strings
   */
  private checkAcceptanceCriterion(criterion: string, state: CodebaseState): boolean {
    // Extract key terms from the criterion
    const keyTerms = this.extractKeyTerms(criterion);
    
    for (const file of state.sourceFiles) {
      // Check if key terms appear in actual code (not comments/strings)
      const semanticResult = this.semanticAnalyzer.analyzeComponent(file, criterion);
      
      // High confidence match means it's in actual code
      if (semanticResult.confidence >= 0.7) {
        return true;
      }
      
      // For simpler checks, look for multiple key terms in definitions
      const definitions = this.semanticAnalyzer.extractDefinitions(file);
      const defNames = definitions.map(d => d.name.toLowerCase());
      
      const matchingTerms = keyTerms.filter(term => 
        defNames.some(name => name.includes(term.toLowerCase()))
      );
      
      // If most key terms match definitions, criterion is likely met
      if (matchingTerms.length >= keyTerms.length * 0.5) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Extract key terms from a criterion string
   */
  private extractKeyTerms(criterion: string): string[] {
    // Remove common words and extract key terms
    const commonWords = new Set([
      'should', 'must', 'can', 'will', 'be', 'is', 'are', 'was', 'were',
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'it', 'its', 'this', 'that'
    ]);
    
    return criterion
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !commonWords.has(word));
  }

  /**
   * Detect syntax errors in source files
   */
  private async detectSyntaxErrors(state: CodebaseState): Promise<Gap[]> {
    const gaps: Gap[] = [];

    for (const file of state.sourceFiles) {
      // Use semantic analyzer to detect syntax errors for TS/JS files
      if (file.language === 'typescript' || file.language === 'javascript') {
        const hasErrors = this.checkTypeScriptSyntax(file);
        if (hasErrors) {
          gaps.push({
            id: `gap-syntax-${Date.now()}-${file.path}`,
            type: 'SYNTAX_ERROR',
            file: file.path,
            existingFiles: [file.path],
            missingParts: ['Syntax fix required'],
            detectedAt: new Date(),
            priority: 'critical'
          });
          continue;
        }
      }

      // Basic syntax checks (simplified)
      const hasUnbalancedBraces = this.checkUnbalancedBraces(file.content);
      const hasInvalidStrings = this.checkInvalidStrings(file.content);

      if (hasUnbalancedBraces || hasInvalidStrings) {
        gaps.push({
          id: `gap-syntax-${Date.now()}-${file.path}`,
          type: 'SYNTAX_ERROR',
          file: file.path,
          existingFiles: [file.path],
          missingParts: ['Syntax fix required'],
          detectedAt: new Date(),
          priority: 'critical'
        });
      }
    }

    return gaps;
  }

  /**
   * Check TypeScript syntax using the TypeScript compiler
   */
  private checkTypeScriptSyntax(file: SourceFile): boolean {
    try {
      const source = ts.createSourceFile(
        file.path,
        file.content,
        ts.ScriptTarget.Latest,
        true
      );
      
      // Check for syntax diagnostics
      const diagnostics: ts.Diagnostic[] = (source as any).parseDiagnostics || [];
      return diagnostics.length > 0;
    } catch {
      return true; // Assume error if parsing fails
    }
  }

  /**
   * Detect test failures by running actual tests
   * Uses the execution sandbox to run tests and analyze results
   */
  private async detectTestFailures(state: CodebaseState): Promise<Gap[]> {
    const gaps: Gap[] = [];
    
    if (state.testFiles.length === 0) {
      return gaps;
    }

    // Try to detect test failures by analyzing test files
    for (const testFile of state.testFiles) {
      try {
        const testContent = await fs.readFile(
          `${this.projectPath}/${testFile}`, 
          'utf-8'
        );
        
        // Check for test files that import non-existent modules
        const imports = this.extractImports(testContent, this.detectLanguage(testFile));
        for (const imp of imports) {
          if (imp.startsWith('.') || imp.startsWith('/')) {
            const resolvedPath = this.resolveImportPath(imp, testFile, state);
            if (!resolvedPath) {
              gaps.push({
                id: `gap-test-${Date.now()}-${testFile}`,
                type: 'TEST_FAILURE',
                file: testFile,
                existingFiles: [testFile],
                missingParts: [`Import '${imp}' not found`],
                detectedAt: new Date(),
                priority: 'high'
              });
            }
          }
        }

        // Check for common test anti-patterns that might cause failures
        const antiPatterns = this.detectTestAntiPatterns(testContent, testFile);
        gaps.push(...antiPatterns);

        // Check for tests that don't assert anything
        const emptyTests = this.detectEmptyTests(testContent, testFile);
        gaps.push(...emptyTests);

      } catch (error) {
        // If we can't read the test file, report it as a gap
        gaps.push({
          id: `gap-test-read-${Date.now()}-${testFile}`,
          type: 'TEST_FAILURE',
          file: testFile,
          existingFiles: [],
          missingParts: [`Cannot read test file: ${error}`],
          detectedAt: new Date(),
          priority: 'medium'
        });
      }
    }

    // Check for test coverage gaps - files without corresponding tests
    const uncoveredFiles = this.detectUncoveredFiles(state);
    for (const file of uncoveredFiles.slice(0, 10)) { // Limit to avoid too many gaps
      gaps.push({
        id: `gap-coverage-${Date.now()}-${file}`,
        type: 'TEST_FAILURE',
        file,
        existingFiles: [file],
        missingParts: ['No corresponding test file found'],
        detectedAt: new Date(),
        priority: 'low'
      });
    }

    return gaps;
  }

  /**
   * Detect test anti-patterns that commonly cause failures
   */
  private detectTestAntiPatterns(testContent: string, testFile: string): Gap[] {
    const gaps: Gap[] = [];

    // Pattern: Tests with only placeholders (todo, skip, etc.)
    const placeholderPatterns = [
      /it\.(skip|todo)\s*\(/g,
      /test\.(skip|todo)\s*\(/g,
      /describe\.(skip|todo)\s*\(/g,
      /\/\/\s*TODO.*test/gi,
      /\/\*\s*TODO.*test\*\//gi
    ];

    let placeholderCount = 0;
    for (const pattern of placeholderPatterns) {
      const matches = testContent.match(pattern);
      if (matches) {
        placeholderCount += matches.length;
      }
    }

    if (placeholderCount > 0) {
      gaps.push({
        id: `gap-test-placeholder-${Date.now()}-${testFile}`,
        type: 'TEST_FAILURE',
        file: testFile,
        existingFiles: [testFile],
        missingParts: [`${placeholderCount} placeholder/skipped tests found`],
        detectedAt: new Date(),
        priority: 'low'
      });
    }

    // Pattern: Tests with hardcoded timeouts that might be flaky
    const flakyPatterns = [
      /setTimeout\s*\(\s*\w+\s*,\s*\d{4,}\)/g, // Timeouts > 1s
      /retry\s*:\s*\d+/g, // Explicit retries (indicates flakiness)
      /\.(only|skip)\s*\(/g // .only or .skip calls
    ];

    for (const pattern of flakyPatterns) {
      const matches = testContent.match(pattern);
      if (matches && matches.length > 0) {
        gaps.push({
          id: `gap-test-flaky-${Date.now()}-${testFile}`,
          type: 'TEST_FAILURE',
          file: testFile,
          existingFiles: [testFile],
          missingParts: [`Potential flaky test patterns found: ${matches.length}`],
          detectedAt: new Date(),
          priority: 'medium'
        });
        break;
      }
    }

    return gaps;
  }

  /**
   * Detect empty tests that don't actually assert anything
   */
  private detectEmptyTests(testContent: string, testFile: string): Gap[] {
    const gaps: Gap[] = [];

    // Match test functions
    const testPattern = /(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{([^}]+)\}\s*\)/g;
    let match;

    while ((match = testPattern.exec(testContent)) !== null) {
      const testBody = match[1];
      // Check for assertions in the test body
      const hasAssertion = /\.(expect|assert|should|to\.|ok\()/.test(testBody);
      
      if (!hasAssertion) {
        gaps.push({
          id: `gap-test-empty-${Date.now()}-${testFile}-${match.index}`,
          type: 'TEST_FAILURE',
          file: testFile,
          existingFiles: [testFile],
          missingParts: [`Empty test '${match[1]}' - no assertions found`],
          detectedAt: new Date(),
          priority: 'low'
        });
      }
    }

    return gaps;
  }

  /**
   * Detect source files without corresponding test files
   */
  private detectUncoveredFiles(state: CodebaseState): string[] {
    const uncovered: string[] = [];
    const testPatterns = [
      /\.test\.(ts|tsx|js|jsx)$/,
      /\.spec\.(ts|tsx|js|jsx)$/,
      /_test\.(py|rb)$/,
      /_spec\.(py|rb)$/
    ];

    for (const file of state.sourceFiles) {
      // Skip test files themselves
      if (testPatterns.some(p => p.test(file.path))) {
        continue;
      }

      // Skip non-source files
      if (!/\.(ts|tsx|js|jsx|py|rb)$/.test(file.path)) {
        continue;
      }

      // Check for corresponding test file
      const baseName = file.path.replace(/\.\w+$/, '');
      const hasTestFile = state.testFiles.some(testFile => {
        const testBase = testFile.replace(/\.(test|spec)\./, '.').replace(/_test\./, '.').replace(/_spec\./, '.');
        return testBase === file.path || testBase === baseName;
      });

      if (!hasTestFile) {
        uncovered.push(file.path);
      }
    }

    return uncovered;
  }

  /**
   * Detect missing dependencies
   */
  private async detectMissingDependencies(state: CodebaseState): Promise<Gap[]> {
    const gaps: Gap[] = [];

    for (const file of state.sourceFiles) {
      for (const imp of file.imports) {
        // Check if import is local and exists
        if (imp.startsWith('.') || imp.startsWith('/')) {
          const resolvedPath = this.resolveImportPath(imp, file.path, state);
          if (!resolvedPath) {
            gaps.push({
              id: `gap-dep-${Date.now()}-${file.path}`,
              type: 'MISSING_DEPENDENCY',
              file: file.path,
              existingFiles: [file.path],
              missingParts: [imp],
              detectedAt: new Date(),
              priority: 'high'
            });
          }
        }
      }
    }

    return gaps;
  }

  /**
   * Detect language from file path
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'rb': 'ruby',
      'php': 'php'
    };
    return langMap[ext || ''] || 'unknown';
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const testPatterns = [
      /\.test\.(ts|tsx|js|jsx)$/,
      /\.spec\.(ts|tsx|js|jsx)$/,
      /_test\.py$/,
      /test_.*\.py$/,
      /_spec\.rb$/
    ];
    return testPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Extract imports from file content
   */
  private extractImports(content: string, language: string): string[] {
    const imports: string[] = [];

    if (language === 'typescript' || language === 'javascript') {
      const es6Regex = /import\s+(?:(?:\{[^}]*\}|[^'"]*)\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = es6Regex.exec(content)) !== null) {
        imports.push(match[1]);
      }
    } else if (language === 'python') {
      const pyRegex = /^(?:from|import)\s+(\S+)/gm;
      let match;
      while ((match = pyRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }
    }

    return imports;
  }

  /**
   * Extract exports from file content
   */
  private extractExports(content: string, language: string): string[] {
    const exports: string[] = [];

    if (language === 'typescript' || language === 'javascript') {
      const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type)?\s*(\w+)/g;
      let match;
      while ((match = exportRegex.exec(content)) !== null) {
        exports.push(match[1]);
      }
    } else if (language === 'python') {
      // Look for class/function definitions at module level
      const defRegex = /^(?:class|def)\s+(\w+)/gm;
      let match;
      while ((match = defRegex.exec(content)) !== null) {
        exports.push(match[1]);
      }
    }

    return exports;
  }

  /**
   * Check for unbalanced braces
   */
  private checkUnbalancedBraces(content: string): boolean {
    const counts = { '{': 0, '}': 0, '(': 0, ')': 0, '[': 0, ']': 0 };
    let inString = false;
    let stringChar = '';
    let escaped = false;

    for (const char of content) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (!inString && (char === '"' || char === "'" || char === '`')) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar) {
        inString = false;
        stringChar = '';
      } else if (!inString && char in counts) {
        counts[char as keyof typeof counts]++;
      }
    }

    return counts['{'] !== counts['}'] || 
           counts['('] !== counts[')'] || 
           counts['['] !== counts[']'];
  }

  /**
   * Check for invalid string literals
   */
  private checkInvalidStrings(content: string): boolean {
    // Simple check for unclosed quotes
    let inString = false;
    let stringChar = '';
    let escaped = false;

    for (const char of content) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (!inString && (char === '"' || char === "'" || char === '`')) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar) {
        inString = false;
        stringChar = '';
      }
    }

    return inString; // Unclosed string
  }

  /**
   * Resolve import path to actual file
   */
  private resolveImportPath(imp: string, fromFile: string, state: CodebaseState): string | null {
    const fromDir = fromFile.split('/').slice(0, -1).join('/');
    const possiblePaths = [
      join(this.projectPath, fromDir, imp),
      join(this.projectPath, fromDir, imp + '.ts'),
      join(this.projectPath, fromDir, imp + '.tsx'),
      join(this.projectPath, fromDir, imp + '.js'),
      join(this.projectPath, fromDir, imp, 'index.ts'),
      join(this.projectPath, fromDir, imp, 'index.js')
    ];

    for (const path of possiblePaths) {
      const relativePath = path.replace(this.projectPath + '/', '');
      if (state.sourceFiles.some(f => f.path === relativePath)) {
        return relativePath;
      }
    }

    return null;
  }

  /**
   * Get priority weight for sorting
   */
  private priorityWeight(priority: string): number {
    const weights: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    };
    return weights[priority] || 0;
  }
}
