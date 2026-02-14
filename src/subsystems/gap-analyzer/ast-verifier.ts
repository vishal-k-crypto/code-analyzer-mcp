/**
 * AST Verifier
 * Uses ts-morph for deep AST analysis to verify actual implementations
 * Replaces brittle regex matching with proper symbol analysis
 */

import { Project, SourceFile as MorphSourceFile, FunctionDeclaration, ClassDeclaration, InterfaceDeclaration, TypeAliasDeclaration, EnumDeclaration, VariableDeclaration } from 'ts-morph';
import type { SourceFile } from '../../types/gap.js';

export interface SymbolVerification {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable';
  exists: boolean;
  hasImplementation: boolean;
  isExported: boolean;
  location?: {
    line: number;
    column: number;
  };
  confidence: number;
  details: {
    bodySize?: number;
    isStub?: boolean;
    hasTODO?: boolean;
    parameterCount?: number;
  };
}

export interface FileAnalysis {
  filePath: string;
  symbols: SymbolVerification[];
  hasExports: boolean;
  isTestFile: boolean;
}

export class ASTVerifier {
  private project: Project;
  private fileCache: Map<string, MorphSourceFile> = new Map();

  constructor() {
    this.project = new Project({
      // Use in-memory file system for analysis
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        skipLibCheck: true,
        target: 2 // ESNext
      }
    });
  }

  /**
   * Analyze a source file and return all verified symbols
   */
  analyzeFile(sourceFile: SourceFile): FileAnalysis {
    // Create or get source file from ts-morph project
    const morphFile = this.getOrCreateSourceFile(sourceFile);
    
    const symbols: SymbolVerification[] = [];
    
    // Analyze all functions
    symbols.push(...this.analyzeFunctions(morphFile, sourceFile.path));
    
    // Analyze all classes
    symbols.push(...this.analyzeClasses(morphFile, sourceFile.path));
    
    // Analyze all interfaces
    symbols.push(...this.analyzeInterfaces(morphFile, sourceFile.path));
    
    // Analyze all type aliases
    symbols.push(...this.analyzeTypeAliases(morphFile, sourceFile.path));
    
    // Analyze all enums
    symbols.push(...this.analyzeEnums(morphFile, sourceFile.path));
    
    // Analyze exported variables
    symbols.push(...this.analyzeVariables(morphFile, sourceFile.path));

    return {
      filePath: sourceFile.path,
      symbols,
      hasExports: symbols.some(s => s.isExported),
      isTestFile: this.isTestFilePattern(sourceFile.path)
    };
  }

  /**
   * Verify if a specific symbol exists with proper implementation
   */
  verifySymbol(sourceFile: SourceFile, symbolName: string): SymbolVerification {
    const analysis = this.analyzeFile(sourceFile);
    const symbol = analysis.symbols.find(s => 
      s.name === symbolName || 
      s.name.toLowerCase() === symbolName.toLowerCase()
    );
    
    if (symbol) {
      return symbol;
    }

    // Symbol not found
    return {
      name: symbolName,
      type: 'variable',
      exists: false,
      hasImplementation: false,
      isExported: false,
      confidence: 0,
      details: {}
    };
  }

  /**
   * Check if a component name matches any verified symbol in the file
   * This replaces the brittle isFileNameMatch check
   */
  findMatchingSymbol(sourceFile: SourceFile, componentName: string): SymbolVerification | null {
    const analysis = this.analyzeFile(sourceFile);
    
    // Try exact match first
    let match = analysis.symbols.find(s => s.name === componentName);
    if (match?.hasImplementation) return match;
    
    // Try case-insensitive match
    match = analysis.symbols.find(s => 
      s.name.toLowerCase() === componentName.toLowerCase()
    );
    if (match?.hasImplementation) return match;
    
    // Try normalized name (remove spaces, convert to PascalCase/camelCase)
    const normalizedComponent = this.normalizeComponentName(componentName);
    match = analysis.symbols.find(s => 
      this.normalizeComponentName(s.name) === normalizedComponent
    );
    if (match?.hasImplementation) return match;
    
    // Try partial match (e.g., "UserAuth" matches "userAuthService")
    match = analysis.symbols.find(s => {
      const normalizedSymbol = this.normalizeComponentName(s.name);
      return normalizedSymbol.includes(normalizedComponent) || 
             normalizedComponent.includes(normalizedSymbol);
    });
    if (match?.hasImplementation) return match;
    
    return null;
  }

  /**
   * Get or create a ts-morph source file
   */
  private getOrCreateSourceFile(sourceFile: SourceFile): MorphSourceFile {
    const cacheKey = `${sourceFile.path}:${sourceFile.content.length}`;
    
    if (this.fileCache.has(cacheKey)) {
      return this.fileCache.get(cacheKey)!;
    }

    const morphFile = this.project.createSourceFile(
      sourceFile.path,
      sourceFile.content,
      { overwrite: true }
    );
    
    this.fileCache.set(cacheKey, morphFile);
    return morphFile;
  }

  /**
   * Analyze all functions in the source file
   */
  private analyzeFunctions(morphFile: MorphSourceFile, _filePath: string): SymbolVerification[] {
    const functions = morphFile.getFunctions();
    return functions.map(func => this.verifyFunction(func));
  }

  /**
   * Verify a single function declaration
   */
  private verifyFunction(func: FunctionDeclaration): SymbolVerification {
    const name = func.getName() || '<anonymous>';
    const hasBody = func.hasBody();
    const bodyText = hasBody ? func.getBody()?.getText() || '' : '';
    const bodySize = bodyText.replace(/[\s{}]/g, '').length;
    const isStub = this.isStubImplementation(bodyText);
    const hasTODO = this.hasTODOComment(bodyText);
    
    return {
      name,
      type: 'function',
      exists: true,
      hasImplementation: hasBody && !isStub && bodySize > 5,
      isExported: func.isExported(),
      location: {
        line: func.getStartLineNumber(),
        column: func.getPos()
      },
      confidence: this.calculateFunctionConfidence(hasBody, isStub, hasTODO, bodySize),
      details: {
        bodySize,
        isStub,
        hasTODO,
        parameterCount: func.getParameters().length
      }
    };
  }

  /**
   * Analyze all classes in the source file
   */
  private analyzeClasses(morphFile: MorphSourceFile, _filePath: string): SymbolVerification[] {
    const classes = morphFile.getClasses();
    return classes.map(cls => this.verifyClass(cls));
  }

  /**
   * Verify a single class declaration
   */
  private verifyClass(cls: ClassDeclaration): SymbolVerification {
    const name = cls.getName() || '<anonymous>';
    // Get class text and calculate body size by removing declaration and braces
    const fullText = cls.getText();
    const declarationEnd = fullText.indexOf('{');
    const bodyText = declarationEnd > 0 ? fullText.slice(declarationEnd) : '';
    const bodySize = bodyText.replace(/[\s{}]/g, '').length;
    const isStub = this.isStubImplementation(bodyText);
    const hasTODO = this.hasTODOComment(bodyText);
    
    // Check if class has meaningful members (not just empty)
    const hasMembers = cls.getMembers().length > 0;
    const hasConstructor = cls.getConstructors().length > 0;
    const hasMethods = cls.getMethods().length > 0;
    const hasProperties = cls.getProperties().length > 0;
    
    const hasRealImplementation = hasMembers && (hasConstructor || hasMethods || hasProperties);
    
    return {
      name,
      type: 'class',
      exists: true,
      hasImplementation: !isStub && (hasRealImplementation || bodySize > 10),
      isExported: cls.isExported(),
      location: {
        line: cls.getStartLineNumber(),
        column: cls.getPos()
      },
      confidence: this.calculateClassConfidence(hasRealImplementation, isStub, hasTODO, bodySize),
      details: {
        bodySize,
        isStub,
        hasTODO,
        parameterCount: cls.getTypeParameters().length
      }
    };
  }

  /**
   * Analyze all interfaces in the source file
   */
  private analyzeInterfaces(morphFile: MorphSourceFile, _filePath: string): SymbolVerification[] {
    const interfaces = morphFile.getInterfaces();
    return interfaces.map(iface => this.verifyInterface(iface));
  }

  /**
   * Verify a single interface declaration
   */
  private verifyInterface(iface: InterfaceDeclaration): SymbolVerification {
    const name = iface.getName();
    const members = iface.getMembers();
    const bodySize = iface.getText().replace(/[\s{}]/g, '').length;
    
    return {
      name,
      type: 'interface',
      exists: true,
      hasImplementation: members.length > 0 || bodySize > 10,
      isExported: iface.isExported(),
      location: {
        line: iface.getStartLineNumber(),
        column: iface.getPos()
      },
      confidence: members.length > 0 ? 1.0 : 0.5,
      details: {
        bodySize
      }
    };
  }

  /**
   * Analyze all type aliases in the source file
   */
  private analyzeTypeAliases(morphFile: MorphSourceFile, _filePath: string): SymbolVerification[] {
    const typeAliases = morphFile.getTypeAliases();
    return typeAliases.map(typeAlias => this.verifyTypeAlias(typeAlias));
  }

  /**
   * Verify a single type alias declaration
   */
  private verifyTypeAlias(typeAlias: TypeAliasDeclaration): SymbolVerification {
    const name = typeAlias.getName();
    const typeText = typeAlias.getTypeNode()?.getText() || '';
    
    return {
      name,
      type: 'type',
      exists: true,
      hasImplementation: typeText.length > 0,
      isExported: typeAlias.isExported(),
      location: {
        line: typeAlias.getStartLineNumber(),
        column: typeAlias.getPos()
      },
      confidence: typeText.length > 0 ? 1.0 : 0.5,
      details: {
        bodySize: typeText.length
      }
    };
  }

  /**
   * Analyze all enums in the source file
   */
  private analyzeEnums(morphFile: MorphSourceFile, _filePath: string): SymbolVerification[] {
    const enums = morphFile.getEnums();
    return enums.map(enumDecl => this.verifyEnum(enumDecl));
  }

  /**
   * Verify a single enum declaration
   */
  private verifyEnum(enumDecl: EnumDeclaration): SymbolVerification {
    const name = enumDecl.getName();
    const members = enumDecl.getMembers();
    
    return {
      name,
      type: 'enum',
      exists: true,
      hasImplementation: members.length > 0,
      isExported: enumDecl.isExported(),
      location: {
        line: enumDecl.getStartLineNumber(),
        column: enumDecl.getPos()
      },
      confidence: members.length > 0 ? 1.0 : 0.5,
      details: {
        bodySize: members.length
      }
    };
  }

  /**
   * Analyze all exported variables in the source file
   */
  private analyzeVariables(morphFile: MorphSourceFile, _filePath: string): SymbolVerification[] {
    const variables: SymbolVerification[] = [];
    
    // Get variable statements
    const varStatements = morphFile.getVariableStatements();
    for (const stmt of varStatements) {
      if (stmt.isExported()) {
        for (const decl of stmt.getDeclarations()) {
          variables.push(this.verifyVariable(decl));
        }
      }
    }
    
    return variables;
  }

  /**
   * Verify a single variable declaration
   */
  private verifyVariable(decl: VariableDeclaration): SymbolVerification {
    const name = decl.getName();
    const initializer = decl.getInitializer()?.getText() || '';
    const isStub = this.isStubImplementation(initializer);
    
    return {
      name,
      type: 'variable',
      exists: true,
      hasImplementation: initializer.length > 0 && !isStub,
      isExported: true,
      location: {
        line: decl.getStartLineNumber(),
        column: decl.getPos()
      },
      confidence: initializer.length > 0 ? 0.8 : 0.3,
      details: {
        bodySize: initializer.length,
        isStub
      }
    };
  }

  /**
   * Check if implementation is just a stub/TODO
   */
  private isStubImplementation(bodyText: string): boolean {
    if (!bodyText) return true;
    
    const normalizedBody = bodyText.toLowerCase().trim();
    
    // Check for common stub patterns
    const stubPatterns = [
      /^\{\s*\}$/, // Empty braces {}
      /^\{\s*\/\/\s*todo.*\}$/i, // { // TODO }
      /^\{\s*throw\s+new\s+error\s*\(['"](not implemented|todo|stub).*\)\s*\}$/i,
      /^\{\s*return\s+(null|undefined|void\s*0)\s*;?\s*\}$/i,
      /^\{\s*\/\*.*\*\/\s*\}$/, // {/* placeholder */}
    ];
    
    return stubPatterns.some(pattern => pattern.test(normalizedBody));
  }

  /**
   * Check if body has TODO comments
   */
  private hasTODOComment(bodyText: string): boolean {
    const todoPattern = /\/\/\s*todo|\/\*\s*todo/i;
    return todoPattern.test(bodyText);
  }

  /**
   * Calculate confidence score for function
   */
  private calculateFunctionConfidence(
    hasBody: boolean, 
    isStub: boolean, 
    hasTODO: boolean, 
    bodySize: number
  ): number {
    if (!hasBody) return 0.1;
    if (isStub) return 0.2;
    if (hasTODO) return 0.4;
    if (bodySize < 10) return 0.6;
    return 1.0;
  }

  /**
   * Calculate confidence score for class
   */
  private calculateClassConfidence(
    hasRealImplementation: boolean,
    isStub: boolean,
    hasTODO: boolean,
    bodySize: number
  ): number {
    if (isStub) return 0.2;
    if (hasTODO) return 0.4;
    if (!hasRealImplementation) return 0.3;
    if (bodySize < 20) return 0.7;
    return 1.0;
  }

  /**
   * Normalize component name for matching
   * Converts "User Auth" to "userAuth" or "UserAuth"
   */
  private normalizeComponentName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/\s+/g, '');
  }

  /**
   * Check if file path matches test file patterns
   */
  private isTestFilePattern(filePath: string): boolean {
    const testPatterns = [
      /\.test\.(ts|tsx|js|jsx)$/,
      /\.spec\.(ts|tsx|js|jsx)$/,
      /_test\.(ts|tsx|js|jsx|py)$/,
      /test_.*\.(ts|tsx|js|jsx|py)$/
    ];
    return testPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Clear the file cache
   */
  clearCache(): void {
    this.fileCache.clear();
  }
}
