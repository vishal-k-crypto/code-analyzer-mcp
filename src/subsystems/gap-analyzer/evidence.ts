/**
 * Evidence Module
 * Handles evidence collection and analysis for gap detection
 * 
 * Provides structured evidence tracking for:
 * - Requirement implementation status
 * - File existence and content verification
 * - Test result analysis
 * - Dependency resolution status
 */

import type { Gap, ParsedRequirement, SourceFile } from '../../types/gap.js';

/**
 * Types of evidence
 */
export type EvidenceType = 
  | 'file_exists'
  | 'symbol_found'
  | 'implementation_complete'
  | 'test_passes'
  | 'test_fails'
  | 'syntax_valid'
  | 'dependency_resolved'
  | 'dependency_missing'
  | 'reference_found';

/**
 * Evidence confidence level
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'uncertain';

/**
 * Individual evidence item
 */
export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  description: string;
  filePath?: string;
  lineNumber?: number;
  confidence: ConfidenceLevel;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Evidence collection for a specific requirement
 */
export interface RequirementEvidence {
  requirementId: string;
  found: boolean;
  complete: boolean;
  confidence: number; // 0-1
  items: EvidenceItem[];
  missingParts: string[];
  files: string[];
}

/**
 * Evidence collector for gap analysis
 */
export class EvidenceCollector {
  private evidence: Map<string, RequirementEvidence> = new Map();
  private items: EvidenceItem[] = [];

  /**
   * Add an evidence item
   */
  addItem(item: Omit<EvidenceItem, 'id' | 'timestamp'>): EvidenceItem {
    const fullItem: EvidenceItem = {
      ...item,
      id: `evidence-${Date.now()}-${this.items.length}`,
      timestamp: new Date()
    };
    
    this.items.push(fullItem);
    return fullItem;
  }

  /**
   * Collect file existence evidence
   */
  addFileEvidence(
    filePath: string, 
    exists: boolean, 
    confidence: ConfidenceLevel = 'high'
  ): EvidenceItem {
    return this.addItem({
      type: exists ? 'file_exists' : 'dependency_missing',
      description: exists ? `File exists: ${filePath}` : `File missing: ${filePath}`,
      filePath,
      confidence,
      metadata: { exists }
    });
  }

  /**
   * Collect symbol/implementation evidence
   */
  addSymbolEvidence(
    filePath: string,
    symbolName: string,
    found: boolean,
    isComplete: boolean,
    confidence: ConfidenceLevel = 'high'
  ): EvidenceItem {
    return this.addItem({
      type: isComplete ? 'implementation_complete' : 'symbol_found',
      description: found 
        ? `Symbol '${symbolName}' ${isComplete ? 'fully implemented' : 'found (may be stub)'}`
        : `Symbol '${symbolName}' not found`,
      filePath,
      confidence,
      metadata: { symbolName, found, isComplete }
    });
  }

  /**
   * Collect test result evidence
   */
  addTestEvidence(
    filePath: string,
    testName: string,
    passes: boolean,
    errorMessage?: string,
    confidence: ConfidenceLevel = 'high'
  ): EvidenceItem {
    return this.addItem({
      type: passes ? 'test_passes' : 'test_fails',
      description: passes 
        ? `Test '${testName}' passes`
        : `Test '${testName}' fails: ${errorMessage || 'unknown error'}`,
      filePath,
      confidence,
      metadata: { testName, passes, errorMessage }
    });
  }

  /**
   * Collect syntax validation evidence
   */
  addSyntaxEvidence(
    filePath: string,
    isValid: boolean,
    errors?: string[],
    confidence: ConfidenceLevel = 'high'
  ): EvidenceItem {
    return this.addItem({
      type: isValid ? 'syntax_valid' : 'dependency_missing',
      description: isValid 
        ? `Syntax valid for ${filePath}`
        : `Syntax errors in ${filePath}: ${errors?.join(', ') || 'unknown errors'}`,
      filePath,
      confidence,
      metadata: { isValid, errors }
    });
  }

  /**
   * Collect dependency resolution evidence
   */
  addDependencyEvidence(
    filePath: string,
    dependencyPath: string,
    resolved: boolean,
    confidence: ConfidenceLevel = 'high'
  ): EvidenceItem {
    return this.addItem({
      type: resolved ? 'dependency_resolved' : 'dependency_missing',
      description: resolved
        ? `Dependency '${dependencyPath}' resolved for ${filePath}`
        : `Dependency '${dependencyPath}' missing for ${filePath}`,
      filePath,
      confidence,
      metadata: { dependencyPath, resolved }
    });
  }

  /**
   * Build requirement evidence from collected items
   */
  buildRequirementEvidence(
    requirement: ParsedRequirement,
    sourceFiles: SourceFile[]
  ): RequirementEvidence {
    const relevantItems = this.items.filter(item => 
      this.isRelevantToRequirement(item, requirement, sourceFiles)
    );

    const files = [...new Set(relevantItems
      .filter(item => item.filePath)
      .map(item => item.filePath!))];

    const missingParts: string[] = [];
    const foundComponents: string[] = [];

    // Check each required component
    for (const component of requirement.components) {
      const componentEvidence = relevantItems.filter(item => 
        item.metadata?.symbolName === component ||
        item.description.includes(component)
      );

      const found = componentEvidence.some(e => 
        e.type === 'symbol_found' || e.type === 'implementation_complete'
      );
      
      const complete = componentEvidence.some(e => 
        e.type === 'implementation_complete'
      );

      if (complete) {
        foundComponents.push(component);
      } else if (found) {
        foundComponents.push(component);
        missingParts.push(`${component} (incomplete)`);
      } else {
        missingParts.push(component);
      }
    }

    // Calculate overall confidence
    const confidence = this.calculateConfidence(relevantItems, requirement);

    const evidence: RequirementEvidence = {
      requirementId: requirement.id,
      found: foundComponents.length > 0,
      complete: missingParts.length === 0 && foundComponents.length === requirement.components.length,
      confidence,
      items: relevantItems,
      missingParts,
      files
    };

    this.evidence.set(requirement.id, evidence);
    return evidence;
  }

  /**
   * Check if evidence item is relevant to a requirement
   */
  private isRelevantToRequirement(
    item: EvidenceItem,
    requirement: ParsedRequirement,
    _sourceFiles: SourceFile[]
  ): boolean {
    // Check if item mentions any component
    for (const component of requirement.components) {
      if (item.description.includes(component) || item.metadata?.symbolName === component) {
        return true;
      }
    }

    // Check if item is in a relevant file
    if (item.filePath) {
      for (const component of requirement.components) {
        const componentFile = component.includes('.') ? component : `${component}.ts`;
        if (item.filePath.includes(componentFile) || item.filePath.includes(component)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Calculate confidence score based on evidence items
   */
  private calculateConfidence(items: EvidenceItem[], requirement: ParsedRequirement): number {
    if (items.length === 0) return 0;

    const confidenceWeights: Record<ConfidenceLevel, number> = {
      high: 1.0,
      medium: 0.7,
      low: 0.4,
      uncertain: 0.2
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const item of items) {
      const weight = confidenceWeights[item.confidence];
      const value = item.type.includes('missing') || item.type.includes('fails') ? 0 : 1;
      weightedSum += weight * value;
      totalWeight += weight;
    }

    const baseConfidence = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Adjust based on component coverage
    const componentCoverage = requirement.components.length > 0
      ? items.filter(i => 
          requirement.components.some(c => 
            i.description.includes(c) || i.metadata?.symbolName === c
          )
        ).length / requirement.components.length
      : 1;

    return baseConfidence * (0.5 + 0.5 * componentCoverage);
  }

  /**
   * Get all evidence for a requirement
   */
  getRequirementEvidence(requirementId: string): RequirementEvidence | undefined {
    return this.evidence.get(requirementId);
  }

  /**
   * Get all collected evidence items
   */
  getAllItems(): EvidenceItem[] {
    return [...this.items];
  }

  /**
   * Clear all evidence
   */
  clear(): void {
    this.evidence.clear();
    this.items = [];
  }

  /**
   * Export evidence to gap format
   */
  toGap(requirement: ParsedRequirement, priority: string): Gap {
    const reqEvidence = this.evidence.get(requirement.id) || {
      requirementId: requirement.id,
      found: false,
      complete: false,
      confidence: 0,
      items: [],
      missingParts: requirement.components,
      files: []
    };

    return {
      id: `gap-${Date.now()}-${requirement.id}`,
      type: reqEvidence.complete ? 'MISSING_IMPLEMENTATION' : 
            reqEvidence.found ? 'PARTIAL_IMPLEMENTATION' : 'MISSING_IMPLEMENTATION',
      requirement,
      existingFiles: reqEvidence.files,
      missingParts: reqEvidence.missingParts,
      detectedAt: new Date(),
      priority: priority as 'critical' | 'high' | 'medium' | 'low'
    };
  }
}

/**
 * Evidence analyzer for detecting patterns in evidence
 */
export class EvidenceAnalyzer {
  /**
   * Analyze evidence to detect recurring patterns
   */
  detectPatterns(evidenceItems: EvidenceItem[]): Map<string, number> {
    const patterns = new Map<string, number>();

    for (const item of evidenceItems) {
      // Pattern by file extension
      if (item.filePath) {
        const ext = item.filePath.split('.').pop();
        if (ext) {
          const key = `extension:${ext}`;
          patterns.set(key, (patterns.get(key) || 0) + 1);
        }
      }

      // Pattern by evidence type
      const typeKey = `type:${item.type}`;
      patterns.set(typeKey, (patterns.get(typeKey) || 0) + 1);

      // Pattern by error message similarity
      if (item.type === 'test_fails' && item.metadata?.errorMessage) {
        const errorKey = this.categorizeError(item.metadata.errorMessage as string);
        patterns.set(`error:${errorKey}`, (patterns.get(`error:${errorKey}`) || 0) + 1);
      }
    }

    return patterns;
  }

  /**
   * Categorize error messages into types
   */
  private categorizeError(errorMessage: string): string {
    const lowerMsg = errorMessage.toLowerCase();
    
    if (lowerMsg.includes('cannot find') || lowerMsg.includes('not found')) {
      return 'not-found';
    }
    if (lowerMsg.includes('type') && lowerMsg.includes('assignable')) {
      return 'type-mismatch';
    }
    if (lowerMsg.includes('undefined') || lowerMsg.includes('null')) {
      return 'null-reference';
    }
    if (lowerMsg.includes('syntax') || lowerMsg.includes('unexpected')) {
      return 'syntax-error';
    }
    if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out')) {
      return 'timeout';
    }
    
    return 'other';
  }

  /**
   * Find files with most issues
   */
  findProblematicFiles(evidenceItems: EvidenceItem[], limit = 5): Array<{ file: string; issueCount: number }> {
    const fileIssues = new Map<string, number>();

    for (const item of evidenceItems) {
      if (item.filePath && (item.type.includes('missing') || item.type.includes('fails'))) {
        fileIssues.set(item.filePath, (fileIssues.get(item.filePath) || 0) + 1);
      }
    }

    return Array.from(fileIssues.entries())
      .map(([file, issueCount]) => ({ file, issueCount }))
      .sort((a, b) => b.issueCount - a.issueCount)
      .slice(0, limit);
  }
}
