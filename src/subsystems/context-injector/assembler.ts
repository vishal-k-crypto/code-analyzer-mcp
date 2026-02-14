/**
 * Context Assembler
 * Assembles bounded context for task execution with semantic search
 */

import { promises as fs } from 'fs';
import { glob } from 'glob';
import { relative } from 'path';
import type { Task, BoundedContext, ProjectGoal } from '../../types/state.js';
import type { FileRelevance, FileIndex, IndexedFile } from '../../types/task.js';
import { VectorStore, VectorSearchResult } from '../../services/vector-store.js';

export class ContextAssembler {
  private projectPath: string;
  private fileIndex: FileIndex | null = null;
  private vectorStore: VectorStore;
  private vectorIndexBuilt = false;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.vectorStore = new VectorStore(projectPath);
  }

  /**
   * Assemble bounded context for a task
   */
  async assembleContext(
    task: Task,
    projectGoal: ProjectGoal | null,
    completedTasks: Task[]
  ): Promise<BoundedContext> {
    // Ensure file index is built
    if (!this.fileIndex) {
      await this.buildFileIndex();
    }

    // Determine relevant files
    const relevantFiles = await this.determineRelevantFiles(task);

    // Determine forbidden files
    const forbiddenFiles = await this.determineForbiddenFiles(task, relevantFiles);

    // Generate instructions
    const instructions = this.generateInstructions(task, projectGoal, completedTasks);

    return {
      relevantFiles,
      forbiddenFiles,
      instructions,
      expectedOutput: task.context.expectedOutput
    };
  }

  /**
   * Build index of project files and generate embeddings
   */
  async buildFileIndex(): Promise<FileIndex> {
    const patterns = [
      '**/*.{ts,tsx,js,jsx,py,rs,go,java,rb,php}',
      '!**/node_modules/**',
      '!**/.git/**',
      '!**/dist/**',
      '!**/build/**',
      '!**/.orchestrator/**',
      '!**/target/**',
      '!**/__pycache__/**',
      '!**/*.min.js'
    ];

    const files = await glob(patterns, { cwd: this.projectPath, absolute: true });
    const indexedFiles: IndexedFile[] = [];

    // Initialize vector store
    await this.vectorStore.initialize();

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const relPath = relative(this.projectPath, filePath);
        const language = this.detectLanguage(filePath);
        const tokens = this.tokenize(content);
        const imports = this.extractImports(content, language);

        // Generate chunks and embeddings for the file
        let chunks;
        try {
          chunks = await this.vectorStore.indexFile(relPath, content);
        } catch (error) {
          console.warn(`Failed to index file ${relPath}:`, error);
        }

        indexedFiles.push({
          path: relPath,
          language,
          content,
          tokens,
          chunks,
          imports,
          importedBy: []
        });
      } catch {
        // Skip files that can't be read
      }
    }

    this.vectorIndexBuilt = true;

    // Build reverse dependency links
    for (const file of indexedFiles) {
      for (const imp of file.imports) {
        const importedFile = indexedFiles.find(f => f.path === imp || f.path.replace(/\.\w+$/, '') === imp);
        if (importedFile) {
          importedFile.importedBy.push(file.path);
        }
      }
    }

    this.fileIndex = {
      files: indexedFiles,
      lastUpdated: new Date()
    };

    return this.fileIndex;
  }

  /**
   * Calculate file relevance scores for a task using semantic + lexical search
   */
  async calculateFileRelevance(task: Task): Promise<FileRelevance[]> {
    if (!this.fileIndex) {
      return [];
    }

    const taskKeywords = this.tokenize(task.title + ' ' + task.description);
    const relevanceScores: FileRelevance[] = [];

    // Get semantic search results
    let semanticResults: VectorSearchResult[] = [];
    if (this.vectorIndexBuilt) {
      try {
        semanticResults = await this.vectorStore.similaritySearch(
          task.description,
          Math.max(this.fileIndex.files.length, 50)
        );
      } catch (error) {
        console.warn('Semantic search failed:', error);
      }
    }

    // Create a map of file path to best semantic score
    const semanticScoreMap = new Map<string, number>();
    for (const result of semanticResults) {
      const currentScore = semanticScoreMap.get(result.filePath) || 0;
      if (result.score > currentScore) {
        semanticScoreMap.set(result.filePath, result.score);
      }
    }

    for (const file of this.fileIndex.files) {
      // Lexical score (traditional keyword matching)
      const lexicalScore = this.computeLexicalScore(taskKeywords, file.tokens);
      
      // Semantic score from vector search (0.7 weight as per requirements)
      const semanticScore = semanticScoreMap.get(file.path) || 0;
      
      // Dependency and cohesion scores
      const dependencyScore = this.computeDependencyScore(task, file);
      const cohesionScore = this.computeCohesionScore(task, file);

      // Combined scoring: semantic 0.7, lexical 0.3 (within their combined weight)
      // The remaining 0.65 is split between dependency (0.35) and cohesion (0.30)
      const combinedTextScore = semanticScore * 0.7 + lexicalScore * 0.3;
      
      // Final weighted score
      const score = 
        combinedTextScore * 0.35 +  // Semantic + Lexical relevance
        dependencyScore * 0.35 +     // Dependency distance
        cohesionScore * 0.30;        // Historical cohesion

      relevanceScores.push({
        path: file.path,
        score,
        signals: {
          lexicalMatch: lexicalScore,
          semanticMatch: semanticScore,
          dependencyDistance: dependencyScore,
          historicalCohesion: cohesionScore
        }
      });
    }

    return relevanceScores
      .filter(r => r.score > 0.1)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Determine relevant files for a task
   */
  private async determineRelevantFiles(task: Task): Promise<string[]> {
    const relevanceScores = await this.calculateFileRelevance(task);
    
    // Take top 20% of files or minimum 5, maximum 20
    const topCount = Math.min(Math.max(Math.floor(relevanceScores.length * 0.2), 5), 20);
    const relevantFiles = relevanceScores.slice(0, topCount).map(r => r.path);

    // Add explicitly mentioned files from task description
    const explicitFiles = this.extractFileReferences(task.description);
    for (const file of explicitFiles) {
      if (!relevantFiles.includes(file)) {
        relevantFiles.push(file);
      }
    }

    // Add files from context if specified
    if (task.context.relevantFiles.length > 0) {
      for (const file of task.context.relevantFiles) {
        if (!relevantFiles.includes(file)) {
          relevantFiles.push(file);
        }
      }
    }

    return relevantFiles;
  }

  /**
   * Determine forbidden files for a task
   */
  private async determineForbiddenFiles(
    task: Task,
    relevantFiles: string[]
  ): Promise<string[]> {
    const forbidden = new Set<string>();

    // All files not in relevant files
    if (this.fileIndex) {
      for (const file of this.fileIndex.files) {
        if (!relevantFiles.includes(file.path)) {
          forbidden.add(file.path);
        }
      }
    }

    // Explicitly locked files from context
    for (const file of task.context.forbiddenFiles) {
      forbidden.add(file);
    }

    // Lock files that have been modified by completed tasks
    // (to prevent regression)
    // This could be made configurable

    return Array.from(forbidden);
  }

  /**
   * Generate instruction block for context
   */
  private generateInstructions(
    task: Task,
    projectGoal: ProjectGoal | null,
    completedTasks: Task[]
  ): string {
    const lines: string[] = [];

    // Master goal summary
    if (projectGoal) {
      lines.push('# MASTER GOAL SUMMARY');
      lines.push(projectGoal.description);
      lines.push('');

      if (projectGoal.requirements.length > 0) {
        lines.push('## Key Requirements');
        for (const req of projectGoal.requirements.slice(0, 5)) {
          lines.push(`- ${req.description} (${req.priority})`);
        }
        lines.push('');
      }
    }

    // Current phase context
    lines.push(`# CURRENT PHASE`);
    lines.push(`Phase ${task.phase}: ${task.title}`);
    lines.push('');

    // Progress context
    if (completedTasks.length > 0) {
      lines.push(`## Progress`);
      lines.push(`${completedTasks.length} tasks completed`);
      const recentTasks = completedTasks.slice(-3);
      for (const t of recentTasks) {
        lines.push(`- ✓ ${t.title}`);
      }
      lines.push('');
    }

    // Task description
    lines.push('# YOUR SINGLE TARGET');
    lines.push(task.description);
    lines.push('');

    // Acceptance criteria
    lines.push('# ACCEPTANCE CRITERIA');
    for (const criterion of task.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
    lines.push('');

    // Context boundary
    lines.push('# CONTEXT BOUNDARY');
    lines.push('- Do NOT refactor unrelated code');
    lines.push('- Do NOT add features beyond this task');
    lines.push('- Do NOT change file names or structures');
    lines.push('- Focus ONLY on the specified target');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Detect programming language from file path
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
   * Simple tokenization for lexical matching
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  /**
   * Extract imports from file content
   */
  private extractImports(content: string, language: string): string[] {
    const imports: string[] = [];

    if (language === 'typescript' || language === 'javascript') {
      // ES6 imports
      const es6Regex = /import\s+(?:(?:\{[^}]*\}|[^'"]*)\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = es6Regex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      // CommonJS requires
      const cjsRegex = /require\(['"]([^'"]+)['"]\)/g;
      while ((match = cjsRegex.exec(content)) !== null) {
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
   * Extract file references from text
   */
  private extractFileReferences(text: string): string[] {
    const refs: string[] = [];
    // Match common file path patterns
    const regex = /[\w./-]+\.(ts|tsx|js|jsx|py|rs|go|java|rb|php)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      refs.push(match[0]);
    }
    return refs;
  }

  /**
   * Compute lexical match score
   */
  private computeLexicalScore(taskTokens: string[], fileTokens: string[]): number {
    const taskSet = new Set(taskTokens);
    const fileSet = new Set(fileTokens);
    
    let matches = 0;
    for (const token of taskSet) {
      if (fileSet.has(token)) {
        matches++;
      }
    }

    return taskSet.size > 0 ? matches / taskSet.size : 0;
  }

  /**
   * Compute dependency distance score
   */
  private computeDependencyScore(task: Task, file: IndexedFile): number {
    // Check if file is mentioned in task context
    if (task.context.relevantFiles.includes(file.path)) {
      return 1.0;
    }

    // Check imports from relevant files
    for (const relevant of task.context.relevantFiles) {
      if (file.importedBy.includes(relevant)) {
        return 0.8;
      }
      if (file.imports.includes(relevant)) {
        return 0.6;
      }
    }

    return 0;
  }

  /**
   * Compute cohesion score based on historical changes
   */
  private computeCohesionScore(_task: Task, _file: IndexedFile): number {
    // This would track files that are commonly changed together
    // For now, return a neutral score
    return 0.5;
  }

  /**
   * Get the vector store instance for external use
   */
  getVectorStore(): VectorStore {
    return this.vectorStore;
  }

  /**
   * PHASE 3: Reactive Vector Indexing
   * Updates the vector index for modified files only.
   * This is more efficient than rebuilding the entire index.
   * 
   * @param modifiedFiles - Array of file paths that were modified
   */
  async updateIndex(modifiedFiles: string[]): Promise<void> {
    if (!this.fileIndex) {
      // If no index exists, build it from scratch
      await this.buildFileIndex();
      return;
    }

    for (const filePath of modifiedFiles) {
      try {
        const fullPath = `${this.projectPath}/${filePath}`;
        let content: string;
        
        try {
          content = await fs.readFile(fullPath, 'utf-8');
        } catch {
          // File may have been deleted, remove from index
          this.fileIndex.files = this.fileIndex.files.filter(f => f.path !== filePath);
          continue;
        }

        const language = this.detectLanguage(filePath);
        const tokens = this.tokenize(content);
        const imports = this.extractImports(content, language);

        // Generate new chunks and embeddings
        let chunks;
        try {
          chunks = await this.vectorStore.indexFile(filePath, content);
        } catch (error) {
          console.warn(`Failed to index file ${filePath}:`, error);
        }

        // Find existing file index or create new
        const existingIndex = this.fileIndex.files.findIndex(f => f.path === filePath);
        const indexedFile: IndexedFile = {
          path: filePath,
          language,
          content,
          tokens,
          chunks,
          imports,
          importedBy: []
        };

        if (existingIndex >= 0) {
          // Preserve importedBy info from old entry
          indexedFile.importedBy = this.fileIndex.files[existingIndex].importedBy;
          this.fileIndex.files[existingIndex] = indexedFile;
        } else {
          this.fileIndex.files.push(indexedFile);
        }
      } catch (error) {
        console.warn(`Failed to update index for ${filePath}:`, error);
      }
    }

    // Rebuild reverse dependency links for modified files
    for (const file of this.fileIndex.files) {
      for (const imp of file.imports) {
        const importedFile = this.fileIndex.files.find(f => 
          f.path === imp || f.path.replace(/\.\w+$/, '') === imp
        );
        if (importedFile && !importedFile.importedBy.includes(file.path)) {
          importedFile.importedBy.push(file.path);
        }
      }
    }

    this.fileIndex.lastUpdated = new Date();
  }

  /**
   * Find test files related to the given source files using the dependency graph.
   * This enables targeted verification - running only tests affected by changes.
   * 
   * @param sourceFiles - Array of source file paths that were modified
   * @returns Array of test file paths that should be run for verification
   */
  getRelatedTestFiles(sourceFiles: string[]): string[] {
    if (!this.fileIndex) {
      return [];
    }

    const relatedTests = new Set<string>();
    const testPatterns = [/(\.test\.|\.spec\.)/, /(_test\.|_spec\.)/, /\/test\//];

    // Helper to check if a file is a test file
    const isTestFile = (path: string): boolean => {
      return testPatterns.some(pattern => pattern.test(path));
    };

    // Helper to get file from index
    const getFile = (path: string): IndexedFile | undefined => {
      return this.fileIndex!.files.find(f => f.path === path);
    };

    // Helper to find test file for a source file (same directory, similar name)
    const findDirectTestFile = (sourcePath: string): string | null => {
      const dir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
      const baseName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1).replace(/\.\w+$/, '');
      const ext = sourcePath.substring(sourcePath.lastIndexOf('.'));
      
      // Check for common test file naming patterns
      const possibleTestNames = [
        `${dir}/${baseName}.test${ext}`,
        `${dir}/${baseName}.spec${ext}`,
        `${dir}/${baseName}_test${ext}`,
        `${dir}/__tests__/${baseName}${ext}`,
        `${dir}/test/${baseName}${ext}`,
      ];

      for (const testName of possibleTestNames) {
        const testFile = getFile(testName);
        if (testFile) {
          return testFile.path;
        }
      }
      return null;
    };

    // For each source file, find related tests
    for (const sourcePath of sourceFiles) {
      // 1. Check if the source file itself is a test file
      if (isTestFile(sourcePath)) {
        relatedTests.add(sourcePath);
        continue;
      }

      // 2. Find the direct test file for this source file
      const directTest = findDirectTestFile(sourcePath);
      if (directTest) {
        relatedTests.add(directTest);
      }

      // 3. Find all test files that import this source file (reverse dependency)
      const sourceFile = getFile(sourcePath);
      if (sourceFile) {
        for (const importer of sourceFile.importedBy) {
          if (isTestFile(importer)) {
            relatedTests.add(importer);
          }
        }
      }

      // 4. Check all test files in the project for imports of this source file
      // This handles cases where tests import the module indirectly
      for (const file of this.fileIndex.files) {
        if (!isTestFile(file.path)) continue;
        
        // Check if this test file imports our source file (directly or via path matching)
        const sourceBaseName = sourcePath.replace(/\.\w+$/, '');
        for (const imp of file.imports) {
          // Match imports like './Component', '../utils', etc.
          if (imp.endsWith('/' + sourceBaseName) || 
              imp === sourceBaseName ||
              sourcePath.endsWith(imp + '.ts') ||
              sourcePath.endsWith(imp + '.tsx') ||
              sourcePath.endsWith(imp + '.js') ||
              sourcePath.endsWith(imp + '.jsx')) {
            relatedTests.add(file.path);
            break;
          }
        }
      }
    }

    return Array.from(relatedTests);
  }

  /**
   * Generate filtered test command for running only related tests.
   * Returns null if no specific tests can be identified (fallback to full suite).
   * 
   * @param sourceFiles - Array of source file paths that were modified
   * @param baseCommand - The base test command (e.g., 'npm test', 'pytest')
   * @returns Filtered command string or null
   */
  generateFilteredTestCommand(sourceFiles: string[], baseCommand: string): string | null {
    const relatedTests = this.getRelatedTestFiles(sourceFiles);
    
    if (relatedTests.length === 0) {
      return null; // No specific tests found, run full suite
    }

    // Generate command based on test runner type
    const cmd = baseCommand.toLowerCase();
    
    // Jest / Vitest (JavaScript/TypeScript)
    if (cmd.includes('jest') || cmd.includes('vitest') || cmd.includes('npm test') || cmd.includes('pnpm test') || cmd.includes('yarn test')) {
      // Jest supports --findRelatedTests flag
      const testPaths = relatedTests.join(' ');
      return `${baseCommand} -- --findRelatedTests ${testPaths}`;
    }
    
    // Pytest (Python)
    if (cmd.includes('pytest') || cmd.includes('python -m pytest')) {
      // Pytest supports running specific test files
      const testPaths = relatedTests.join(' ');
      return `${baseCommand} ${testPaths}`;
    }
    
    // Mocha (JavaScript)
    if (cmd.includes('mocha')) {
      const testPaths = relatedTests.join(' ');
      return `${baseCommand} ${testPaths}`;
    }
    
    // Cargo (Rust) - uses module paths, harder to filter by file
    if (cmd.includes('cargo test')) {
      // For Rust, we can try to extract module names from test files
      // This is a simplified approach
      return null; // Fall back to full suite for Rust
    }
    
    // Go test
    if (cmd.includes('go test')) {
      // Go test supports running tests in specific directories
      const testDirs = new Set<string>();
      for (const testPath of relatedTests) {
        const dir = testPath.substring(0, testPath.lastIndexOf('/'));
        if (dir) testDirs.add(dir);
      }
      if (testDirs.size > 0) {
        const dirPaths = Array.from(testDirs).join(' ');
        return `go test ${dirPaths} -v`;
      }
      return null;
    }
    
    // Maven (Java)
    if (cmd.includes('mvn test')) {
      // Maven can run specific test classes, but extracting class names from paths is complex
      return null; // Fall back to full suite for Java
    }

    return null; // Unknown test runner, fall back to full suite
  }

  /**
   * Update a single file in the index (for incremental updates after file changes)
   * This prevents vector store staleness when files are modified during task execution.
   */
  async updateFileInIndex(filePath: string, content: string): Promise<void> {
    // Ensure index is built first
    if (!this.fileIndex) {
      await this.buildFileIndex();
      return;
    }

    // Initialize vector store if needed
    await this.vectorStore.initialize();

    const relPath = filePath.startsWith(this.projectPath) 
      ? relative(this.projectPath, filePath)
      : filePath;

    const language = this.detectLanguage(filePath);
    const tokens = this.tokenize(content);

    // Extract imports from content
    const imports = this.extractImports(content, language);

    // Generate chunks and embeddings for the file
    let chunks;
    try {
      chunks = await this.vectorStore.indexFile(relPath, content);
    } catch (error) {
      console.warn(`Failed to index updated file ${relPath}:`, error);
    }

    // Find existing file index
    const existingIndex = this.fileIndex.files.findIndex(f => f.path === relPath);

    if (existingIndex >= 0) {
      // Update existing file entry
      const oldFile = this.fileIndex.files[existingIndex];
      
      // Remove old import references
      for (const file of this.fileIndex.files) {
        file.importedBy = file.importedBy.filter(p => p !== relPath);
      }

      // Update the file entry
      this.fileIndex.files[existingIndex] = {
        path: relPath,
        language,
        content,
        tokens,
        chunks,
        imports,
        importedBy: oldFile.importedBy // Preserve importedBy, will be recalculated
      };
    } else {
      // Add new file entry
      this.fileIndex.files.push({
        path: relPath,
        language,
        content,
        tokens,
        chunks,
        imports,
        importedBy: []
      });
    }

    // Rebuild reverse dependency links for all files
    for (const file of this.fileIndex.files) {
      for (const imp of file.imports) {
        const importedFile = this.fileIndex.files.find(
          f => f.path === imp || f.path.replace(/\.\w+$/, '') === imp
        );
        if (importedFile && !importedFile.importedBy.includes(file.path)) {
          importedFile.importedBy.push(file.path);
        }
      }
    }

    // Update last updated timestamp
    this.fileIndex.lastUpdated = new Date();
  }

  /**
   * Invalidate the file index to force a rebuild on next use
   */
  invalidateFileIndex(): void {
    this.fileIndex = null;
    this.vectorIndexBuilt = false;
  }
}
