/**
 * Semantic Code Analyzer
 * PHASE 2: Uses ts-morph for AST-based targeted verification
 * 
 * Upgrades:
 * - AST-based function detection with complexity scoring
 * - Precise definition matching using ts-morph
 * - Targeted verification: "login function" must be function login() with complexity > 0
 */

import * as ts from 'typescript';
import { Project, SourceFile as MorphSourceFile, FunctionDeclaration,
         ArrowFunction, MethodDeclaration, SyntaxKind, Node } from 'ts-morph';
import type { SourceFile } from '../../types/gap.js';

export interface SemanticMatch {
  found: boolean;
  confidence: number;
  locations: MatchLocation[];
  matchType: 'definition' | 'import' | 'reference' | 'comment' | 'string';
}

export interface MatchLocation {
  filePath: string;
  line: number;
  column: number;
  context: string;
}

export interface ComponentDefinition {
  name: string;
  type: 'class' | 'function' | 'interface' | 'type' | 'variable' | 'enum' | 'method';
  isExported: boolean;
  location: MatchLocation;
  complexity?: number; // PHASE 2: Cyclomatic complexity score
  parameters?: string[]; // PHASE 2: Function parameters for targeted matching
  returnType?: string; // PHASE 2: Return type for verification
}

/**
 * PHASE 2: Function complexity analysis result
 */
export interface FunctionAnalysis {
  name: string;
  complexity: number;
  lineCount: number;
  hasBody: boolean;
  isAsync: boolean;
  parameters: string[];
  returnType: string;
}

export class SemanticCodeAnalyzer {
  private tsMorphProject: Project | null = null;

  /**
   * PHASE 2: Initialize ts-morph project for advanced analysis
   */
  private getTsMorphProject(): Project {
    if (!this.tsMorphProject) {
      this.tsMorphProject = new Project({
        skipAddingFilesFromTsConfig: true,
        skipFileDependencyResolution: true,
      });
    }
    return this.tsMorphProject;
  }

  /**
   * PHASE 2: AST-based targeted verification
   * 
   * Algorithm: If Requirement = "Create login function", 
   * AST must confirm:
   * 1. Function login() exists
   * 2. Has a complexity score > 0 (not just an empty stub)
   * 3. Has actual implementation body
   */
  verifyFunctionImplementation(
    sourceFile: SourceFile, 
    functionName: string
  ): { exists: boolean; complexity: number; isValid: boolean; details: FunctionAnalysis | null } {
    
    if (!this.isTypeScriptFile(sourceFile.language)) {
      // For non-TS files, fall back to basic regex
      return this.fallbackFunctionVerification(sourceFile, functionName);
    }

    const project = this.getTsMorphProject();
    const morphFile = project.createSourceFile(
      sourceFile.path, 
      sourceFile.content, 
      { overwrite: true }
    );

    try {
      // Find function by name - check all function types
      const functionDecl = this.findFunctionByName(morphFile, functionName);
      
      if (!functionDecl) {
        return { exists: false, complexity: 0, isValid: false, details: null };
      }

      // Analyze the function
      const analysis = this.analyzeFunction(functionDecl);
      
      // PHASE 2: Validation criteria
      // - Must have complexity > 0 (not just an empty function)
      // - Must have a body (not just a declaration)
      const isValid = analysis.complexity > 0 && analysis.hasBody && analysis.lineCount > 2;

      return {
        exists: true,
        complexity: analysis.complexity,
        isValid,
        details: analysis
      };
    } finally {
      // Clean up the temporary source file
      project.removeSourceFile(morphFile);
    }
  }

  /**
   * PHASE 2: Find function by name in a source file
   * Checks function declarations, arrow functions assigned to const, and class methods
   */
  private findFunctionByName(
    file: MorphSourceFile, 
    name: string
  ): FunctionDeclaration | ArrowFunction | MethodDeclaration | undefined {
    
    // 1. Check for function declaration
    const funcDecl = file.getFunction(name);
    if (funcDecl) return funcDecl;

    // 2. Check for arrow function assigned to const
    const variable = file.getVariableDeclaration(name);
    if (variable) {
      const initializer = variable.getInitializer();
      if (initializer && (
        initializer.getKind() === SyntaxKind.ArrowFunction ||
        initializer.getKind() === SyntaxKind.FunctionExpression
      )) {
        return initializer as ArrowFunction;
      }
    }

    // 3. Check for method in classes
    for (const classDecl of file.getClasses()) {
      const method = classDecl.getMethod(name);
      if (method) return method;
    }

    return undefined;
  }

  /**
   * PHASE 2: Analyze function complexity and structure
   */
  private analyzeFunction(
    func: FunctionDeclaration | ArrowFunction | MethodDeclaration
  ): FunctionAnalysis {
    // Get name based on function type
    let name: string;
    if (func.getKind() === SyntaxKind.FunctionDeclaration) {
      name = (func as FunctionDeclaration).getName?.() || 'anonymous';
    } else if (func.getKind() === SyntaxKind.MethodDeclaration) {
      name = (func as MethodDeclaration).getName?.() || 'anonymous';
    } else {
      name = 'anonymous';
    }
    const body = func.getBody();
    const hasBody = !!body;
    
    // Calculate cyclomatic complexity
    const complexity = hasBody ? this.calculateCyclomaticComplexity(body!) : 0;
    
    // Count lines (approximation)
    const lineCount = hasBody ? body!.getText().split('\n').length : 0;
    
    // Check if async
    const isAsync = func.isAsync?.() || 
      func.getModifiers().some(m => m.getKind() === SyntaxKind.AsyncKeyword);
    
    // Get parameters
    const parameters = func.getParameters().map(p => {
      const type = p.getType().getText();
      return `${p.getName()}: ${type}`;
    });
    
    // Get return type
    const returnType = func.getReturnType().getText();

    return {
      name,
      complexity,
      lineCount,
      hasBody,
      isAsync,
      parameters,
      returnType
    };
  }

  /**
   * PHASE 2: Calculate cyclomatic complexity
   * Counts decision points: if, for, while, switch, catch, ternary, &&, ||
   */
  private calculateCyclomaticComplexity(body: Node): number {
    let complexity = 1; // Base complexity
    const text = body.getText?.() || '';
    
    // Count decision points
    const decisionPatterns = [
      /\bif\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bswitch\s*\(/g,
      /\bcatch\s*\(/g,
      /\?\s*[^:]*:/g, // ternary
      /\|\|/g, // logical OR
      /&&/g, // logical AND
    ];

    for (const pattern of decisionPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  /**
   * PHASE 2: Fallback verification for non-TS files
   */
  private fallbackFunctionVerification(
    sourceFile: SourceFile, 
    functionName: string
  ): { exists: boolean; complexity: number; isValid: boolean; details: FunctionAnalysis | null } {
    
    const patterns: Record<string, RegExp> = {
      python: new RegExp(`^def\\s+${functionName}\\s*\\(`, 'm'),
      rust: new RegExp(`^fn\\s+${functionName}\\s*\\(`, 'm'),
      go: new RegExp(`^func\\s+.*\\b${functionName}\\s*\\(`, 'm'),
      ruby: new RegExp(`^def\\s+${functionName}\\b`, 'm'),
      java: new RegExp(`\\b${functionName}\\s*\\([^)]*\\)\\s*\\{`, 'm'),
      php: new RegExp(`^function\\s+${functionName}\\s*\\(`, 'm'),
    };

    const pattern = patterns[sourceFile.language];
    if (!pattern) {
      return { exists: false, complexity: 0, isValid: false, details: null };
    }

    const match = sourceFile.content.match(pattern);
    if (!match) {
      return { exists: false, complexity: 0, isValid: false, details: null };
    }

    // Basic complexity estimation for non-TS files
    const funcStart = match.index!;
    const funcEnd = this.findFunctionEnd(sourceFile.content, funcStart, sourceFile.language);
    const funcBody = sourceFile.content.slice(funcStart, funcEnd);
    
    // Count decision keywords
    const decisionCount = (
      (funcBody.match(/\bif\b/g) || []).length +
      (funcBody.match(/\bfor\b/g) || []).length +
      (funcBody.match(/\bwhile\b/g) || []).length +
      (funcBody.match(/\bcatch\b/g) || []).length +
      (funcBody.match(/\?/g) || []).length
    );
    
    const lineCount = funcBody.split('\n').length;
    const complexity = 1 + decisionCount;

    return {
      exists: true,
      complexity,
      isValid: complexity > 0 && lineCount > 2,
      details: {
        name: functionName,
        complexity,
        lineCount,
        hasBody: lineCount > 2,
        isAsync: funcBody.includes('async') || funcBody.includes('await'),
        parameters: [], // Would need more sophisticated parsing
        returnType: 'unknown'
      }
    };
  }

  /**
   * PHASE 2: Find the end of a function for non-TS files
   */
  private findFunctionEnd(content: string, start: number, language: string): number {
    let braceCount = 0;
    let inString = false;
    let stringChar = '';
    let i = start;

    // For Python/Ruby, find next top-level construct or EOF
    if (language === 'python' || language === 'ruby') {
      const lines = content.slice(start).split('\n');
      let lineCount = 0;
      for (const line of lines.slice(1)) {
        if (line.match(/^(def |class |#|$)/)) break;
        lineCount++;
      }
      return start + lines.slice(0, lineCount + 1).join('\n').length;
    }

    // For brace-based languages
    for (; i < content.length; i++) {
      const char = content[i];
      
      if (!inString) {
        if (char === '{' && !inString) {
          braceCount++;
        } else if (char === '}' && !inString) {
          braceCount--;
          if (braceCount === 0) {
            return i + 1;
          }
        } else if (char === '"' || char === "'" || char === '`') {
          inString = true;
          stringChar = char;
        }
      } else {
        if (char === stringChar && content[i - 1] !== '\\') {
          inString = false;
        }
      }
    }

    return i;
  }

  /**
   * Check if a component is actually implemented (not just mentioned in comments)
   * PHASE 2: Enhanced with ts-morph for TypeScript files
   */
  analyzeComponent(sourceFile: SourceFile, componentName: string): SemanticMatch {
    const locations: MatchLocation[] = [];
    let hasDefinition = false;
    let hasRealReference = false;
    let commentMatches = 0;
    let stringMatches = 0;

    // Parse the file with TypeScript
    const source = this.parseSourceFile(sourceFile);
    if (!source) {
      // Fallback to regex-based detection for non-TS files
      return this.fallbackAnalysis(sourceFile, componentName);
    }

    // Get comment ranges to exclude them
    const commentRanges = this.getCommentRanges(source);

    // Traverse the AST to find actual definitions and references
    const visit = (node: ts.Node) => {
      const nodeText = node.getText(source);
      
      if (nodeText.includes(componentName)) {
        const pos = source.getLineAndCharacterOfPosition(node.getStart());
        const isInComment = this.isPositionInComment(node.getStart(), commentRanges);
        
        if (isInComment) {
          commentMatches++;
        } else if (this.isStringLiteral(node)) {
          stringMatches++;
        } else {
          // Check if it's a definition
          const defType = this.getDefinitionType(node, componentName);
          if (defType) {
            hasDefinition = true;
            locations.push({
              filePath: sourceFile.path,
              line: pos.line + 1,
              column: pos.character + 1,
              context: nodeText.slice(0, 100)
            });
          } else if (this.isRealReference(node, componentName)) {
            // Check if it's a real code reference (not just a string match)
            hasRealReference = true;
            if (!locations.find(l => l.line === pos.line + 1)) {
              locations.push({
                filePath: sourceFile.path,
                line: pos.line + 1,
                column: pos.character + 1,
                context: nodeText.slice(0, 100)
              });
            }
          }
        }
      }
      
      ts.forEachChild(node, visit);
    };

    visit(source);

    // Calculate confidence based on match types
    let confidence = 0;
    let matchType: SemanticMatch['matchType'] = 'reference';

    if (hasDefinition) {
      confidence = 1.0;
      matchType = 'definition';
    } else if (hasRealReference) {
      confidence = 0.7;
      matchType = 'reference';
    } else if (stringMatches > 0) {
      confidence = 0.2;
      matchType = 'string';
    } else if (commentMatches > 0) {
      confidence = 0.1;
      matchType = 'comment';
    }

    return {
      found: hasDefinition || hasRealReference,
      confidence,
      locations,
      matchType
    };
  }

  /**
   * PHASE 2: Get all component definitions from a source file using ts-morph
   * Includes complexity scoring for functions
   */
  extractDefinitions(sourceFile: SourceFile): ComponentDefinition[] {
    if (!this.isTypeScriptFile(sourceFile.language)) {
      // Fall back to regex-based for non-TS files
      return this.extractDefinitionsFallback(sourceFile);
    }

    const definitions: ComponentDefinition[] = [];
    const project = this.getTsMorphProject();
    const morphFile = project.createSourceFile(
      sourceFile.path,
      sourceFile.content,
      { overwrite: true }
    );

    try {
      // Classes
      for (const classDecl of morphFile.getClasses()) {
        const location = this.getMorphLocation(classDecl, sourceFile.path);
        definitions.push({
          name: classDecl.getName() || 'anonymous',
          type: 'class',
          isExported: classDecl.isExported(),
          location
        });

        // Class methods
        const classIsExported = classDecl.isExported();
        for (const method of classDecl.getMethods()) {
          const methodLoc = this.getMorphLocation(method, sourceFile.path);
          const body = method.getBody();
          const complexity = body ? this.calculateCyclomaticComplexity(body) : 0;
          
          // Methods inherit export status from their class
          const methodIsExported = classIsExported || 
            method.getModifiers().some(m => m.getKind() === SyntaxKind.ExportKeyword);
          
          definitions.push({
            name: `${classDecl.getName()}.${method.getName()}`,
            type: 'method',
            isExported: methodIsExported,
            location: methodLoc,
            complexity,
            parameters: method.getParameters().map(p => p.getName()),
            returnType: method.getReturnType().getText()
          });
        }
      }

      // Functions
      for (const func of morphFile.getFunctions()) {
        const location = this.getMorphLocation(func, sourceFile.path);
        const body = func.getBody();
        const complexity = body ? this.calculateCyclomaticComplexity(body) : 0;

        definitions.push({
          name: func.getName() || 'anonymous',
          type: 'function',
          isExported: func.isExported(),
          location,
          complexity,
          parameters: func.getParameters().map(p => p.getName()),
          returnType: func.getReturnType().getText()
        });
      }

      // Interfaces
      for (const iface of morphFile.getInterfaces()) {
        definitions.push({
          name: iface.getName(),
          type: 'interface',
          isExported: iface.isExported(),
          location: this.getMorphLocation(iface, sourceFile.path)
        });
      }

      // Type aliases
      for (const typeAlias of morphFile.getTypeAliases()) {
        definitions.push({
          name: typeAlias.getName(),
          type: 'type',
          isExported: typeAlias.isExported(),
          location: this.getMorphLocation(typeAlias, sourceFile.path)
        });
      }

      // Enums
      for (const enumDecl of morphFile.getEnums()) {
        definitions.push({
          name: enumDecl.getName(),
          type: 'enum',
          isExported: enumDecl.isExported(),
          location: this.getMorphLocation(enumDecl, sourceFile.path)
        });
      }

      // Arrow functions assigned to const
      for (const varDecl of morphFile.getVariableDeclarations()) {
        const initializer = varDecl.getInitializer();
        if (initializer && (
          initializer.getKind() === SyntaxKind.ArrowFunction ||
          initializer.getKind() === SyntaxKind.FunctionExpression
        )) {
          const arrowFunc = initializer as ArrowFunction;
          const location = this.getMorphLocation(varDecl, sourceFile.path);
          const body = arrowFunc.getBody();
          const complexity = body && body.getKind() === SyntaxKind.Block 
            ? this.calculateCyclomaticComplexity(body as import('ts-morph').Block)
            : 0;

          definitions.push({
            name: varDecl.getName(),
            type: 'function',
            isExported: varDecl.getVariableStatement()?.isExported() || false,
            location,
            complexity,
            parameters: arrowFunc.getParameters().map(p => p.getName()),
            returnType: arrowFunc.getReturnType().getText()
          });
        }
      }

      return definitions;
    } finally {
      project.removeSourceFile(morphFile);
    }
  }

  /**
   * PHASE 2: Helper to get location from ts-morph node
   */
  private getMorphLocation(
    node: Node,
    filePath: string
  ): MatchLocation {
    const start = node.getStart();
    const sourceFile = node.getSourceFile();
    const lineAndCol = sourceFile.getLineAndColumnAtPos(start);
    
    return {
      filePath,
      line: lineAndCol.line,
      column: lineAndCol.column,
      context: node.getText().slice(0, 100)
    };
  }

  /**
   * Fallback for non-TypeScript files
   */
  private extractDefinitionsFallback(sourceFile: SourceFile): ComponentDefinition[] {
    const definitions: ComponentDefinition[] = [];
    
    const source = this.parseSourceFile(sourceFile);
    if (!source) return definitions;

    const visit = (node: ts.Node) => {
      const pos = source.getLineAndCharacterOfPosition(node.getStart());
      const location: MatchLocation = {
        filePath: sourceFile.path,
        line: pos.line + 1,
        column: pos.character + 1,
        context: node.getText(source).slice(0, 100)
      };

      // Class declaration
      if (ts.isClassDeclaration(node) && node.name) {
        definitions.push({
          name: node.name.text,
          type: 'class',
          isExported: this.isExported(node),
          location
        });
      }
      // Function declaration
      else if (ts.isFunctionDeclaration(node) && node.name) {
        definitions.push({
          name: node.name.text,
          type: 'function',
          isExported: this.isExported(node),
          location
        });
      }
      // Interface declaration
      else if (ts.isInterfaceDeclaration(node) && node.name) {
        definitions.push({
          name: node.name.text,
          type: 'interface',
          isExported: this.isExported(node),
          location
        });
      }
      // Type alias
      else if (ts.isTypeAliasDeclaration(node) && node.name) {
        definitions.push({
          name: node.name.text,
          type: 'type',
          isExported: this.isExported(node),
          location
        });
      }
      // Enum declaration
      else if (ts.isEnumDeclaration(node) && node.name) {
        definitions.push({
          name: node.name.text,
          type: 'enum',
          isExported: this.isExported(node),
          location
        });
      }
      // Variable statement (const, let, var)
      else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            definitions.push({
              name: decl.name.text,
              type: 'variable',
              isExported: this.isExported(node),
              location
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
    return definitions;
  }

  /**
   * Check if component is defined in the file
   */
  hasDefinition(sourceFile: SourceFile, componentName: string): boolean {
    const defs = this.extractDefinitions(sourceFile);
    return defs.some(d => d.name === componentName);
  }

  /**
   * Parse source file into TypeScript AST
   */
  private parseSourceFile(sourceFile: SourceFile): ts.SourceFile | null {
    if (!this.isTypeScriptFile(sourceFile.language)) {
      return null;
    }

    // Use TypeScript to parse the file
    return ts.createSourceFile(
      sourceFile.path,
      sourceFile.content,
      ts.ScriptTarget.Latest,
      true,
      this.getScriptKind(sourceFile.path)
    );
  }

  /**
   * Get all comment ranges in the source file
   */
  private getCommentRanges(source: ts.SourceFile): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    
    const visit = (node: ts.Node) => {
      const leadingRanges = ts.getLeadingCommentRanges(source.text, node.getFullStart());
      const trailingRanges = ts.getTrailingCommentRanges(source.text, node.getEnd());
      
      if (leadingRanges) {
        ranges.push(...leadingRanges.map(r => ({ start: r.pos, end: r.end })));
      }
      if (trailingRanges) {
        ranges.push(...trailingRanges.map(r => ({ start: r.pos, end: r.end })));
      }
      
      ts.forEachChild(node, visit);
    };

    visit(source);
    return ranges;
  }

  /**
   * Check if a position is within a comment range
   */
  private isPositionInComment(pos: number, commentRanges: Array<{ start: number; end: number }>): boolean {
    return commentRanges.some(range => pos >= range.start && pos < range.end);
  }

  /**
   * Check if node is a string literal
   */
  private isStringLiteral(node: ts.Node): boolean {
    return ts.isStringLiteral(node) || ts.isTemplateLiteral(node) || 
           (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name));
  }

  /**
   * Get definition type if node is a definition of componentName
   */
  private getDefinitionType(node: ts.Node, componentName: string): string | null {
    // Check various declaration types
    if (ts.isClassDeclaration(node) && node.name?.text === componentName) {
      return 'class';
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === componentName) {
      return 'function';
    }
    if (ts.isInterfaceDeclaration(node) && node.name?.text === componentName) {
      return 'interface';
    }
    if (ts.isTypeAliasDeclaration(node) && node.name?.text === componentName) {
      return 'type';
    }
    if (ts.isEnumDeclaration(node) && node.name?.text === componentName) {
      return 'enum';
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && 
        node.name.text === componentName) {
      return 'variable';
    }
    return null;
  }

  /**
   * Check if node is a real reference to the component (not just string match)
   */
  private isRealReference(node: ts.Node, componentName: string): boolean {
    // Check if it's an identifier with the component name
    if (ts.isIdentifier(node) && node.text === componentName) {
      return true;
    }
    // Check property access
    if (ts.isPropertyAccessExpression(node) && node.name.text === componentName) {
      return true;
    }
    return false;
  }

  /**
   * Check if a declaration is exported
   */
  private isExported(node: ts.Node): boolean {
    return !!(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
  }

  /**
   * Check if file is TypeScript/JavaScript
   */
  private isTypeScriptFile(language: string): boolean {
    return language === 'typescript' || language === 'javascript';
  }

  /**
   * Get script kind from file path
   */
  private getScriptKind(filePath: string): ts.ScriptKind {
    if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
    if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
    if (filePath.endsWith('.js')) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
  }

  /**
   * Fallback analysis for non-TypeScript files
   */
  private fallbackAnalysis(sourceFile: SourceFile, componentName: string): SemanticMatch {
    const content = sourceFile.content;
    
    // Check for Python/Rust/Go definitions
    const patterns = this.getLanguagePatterns(sourceFile.language, componentName);
    let found = false;
    const locations: MatchLocation[] = [];

    for (const pattern of patterns) {
      // Use 'm' flag so ^ matches start of each line
      const regex = new RegExp(pattern, 'gm');
      let match;
      while ((match = regex.exec(content)) !== null) {
        found = true;
        const lineNum = content.slice(0, match.index).split('\n').length;
        locations.push({
          filePath: sourceFile.path,
          line: lineNum,
          column: match.index - content.lastIndexOf('\n', match.index),
          context: match[0].slice(0, 100)
        });
      }
    }

    return {
      found,
      confidence: found ? 0.8 : 0,
      locations,
      matchType: found ? 'definition' : 'reference'
    };
  }

  /**
   * Get language-specific definition patterns
   */
  private getLanguagePatterns(language: string, componentName: string): string[] {
    const patterns: Record<string, string[]> = {
      python: [
        `^class\\s+${componentName}\\b`,
        `^def\\s+${componentName}\\b`,
        `^${componentName}\\s*=`
      ],
      rust: [
        `^struct\\s+${componentName}\\b`,
        `^fn\\s+${componentName}\\b`,
        `^impl\\s+.*\\b${componentName}\\b`,
        `^trait\\s+${componentName}\\b`
      ],
      go: [
        `^func\\s+.*\\b${componentName}\\b`,
        `^type\\s+${componentName}\\b`,
        `^var\\s+${componentName}\\b`
      ],
      ruby: [
        `^class\\s+${componentName}\\b`,
        `^def\\s+${componentName}\\b`,
        `^module\\s+${componentName}\\b`
      ],
      java: [
        `^class\\s+${componentName}\\b`,
        `^interface\\s+${componentName}\\b`,
        `^public\\s+.*\\b${componentName}\\b`
      ],
      php: [
        `^class\\s+${componentName}\\b`,
        `^function\\s+${componentName}\\b`,
        `^interface\\s+${componentName}\\b`
      ]
    };

    return patterns[language] || [];
  }
}
