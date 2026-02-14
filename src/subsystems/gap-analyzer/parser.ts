/**
 * Requirement Parser
 * Parses natural language project goals into structured requirements
 * Uses LLM when API key is available, falls back to rule-based parsing
 */

import type { ParsedRequirement } from '../../types/gap.js';
import { LLMClient } from '../../services/llm-client.js';
import { getLLMConfig, isLLMAvailable } from '../../utils/config.js';

export interface ParseResult {
  requirements: ParsedRequirement[];
  method: 'llm' | 'rule-based';
  error?: string;
}

export class RequirementParser {
  private llmClient: LLMClient | null = null;

  constructor() {
    // Initialize LLM client if API key is available
    if (isLLMAvailable()) {
      const config = getLLMConfig();
      if (config.apiKey) {
        this.llmClient = new LLMClient(config);
      }
    }
  }

  /**
   * Parse a project goal description into structured requirements
   * Tries LLM first if available, falls back to rule-based parsing
   */
  async parse(description: string): Promise<ParsedRequirement[]> {
    const result = await this.parseWithMethod(description);
    return result.requirements;
  }

  /**
   * Parse with full result metadata (method used, errors, etc.)
   */
  async parseWithMethod(description: string): Promise<ParseResult> {
    // Try LLM parsing first if available
    if (this.llmClient) {
      try {
        const requirements = await this.llmClient.parseRequirements(description);
        
        // Validate LLM response
        if (requirements.length === 0) {
          throw new Error('LLM returned empty requirements array');
        }

        return {
          requirements,
          method: 'llm'
        };
      } catch (error) {
        // Log LLM error and fall back to rule-based parsing
        console.error('LLM parsing failed, falling back to rule-based:', error);
        
        const requirements = this.parseRuleBased(description);
        return {
          requirements,
          method: 'rule-based',
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    // Use rule-based parsing as fallback
    const requirements = this.parseRuleBased(description);
    return {
      requirements,
      method: 'rule-based'
    };
  }

  /**
   * Check if LLM parsing is available
   */
  isLLMAvailable(): boolean {
    return this.llmClient !== null;
  }

  /**
   * Rule-based parsing (original implementation)
   * Used as fallback when LLM is not available or fails
   */
  private parseRuleBased(description: string): ParsedRequirement[] {
    const requirements: ParsedRequirement[] = [];
    
    // Split into sentences and paragraphs
    const sections = this.splitIntoSections(description);
    
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i].trim();
      if (!section) continue;

      const req = this.parseSection(section, i);
      if (req) {
        requirements.push(req);
      }
    }

    // Add default requirements if none found
    if (requirements.length === 0) {
      requirements.push(this.createDefaultRequirement(description));
    }

    // Resolve dependencies
    this.resolveDependencies(requirements);

    return requirements;
  }

  /**
   * Split description into logical sections
   */
  private splitIntoSections(description: string): string[] {
    // Split by numbered lists, bullet points, or newlines
    const patterns = [
      /\n\s*\d+\.\s+/,  // Numbered lists
      /\n\s*[-*]\s+/,  // Bullet points
      /\n\n+/           // Paragraph breaks
    ];

    let sections = [description];
    for (const pattern of patterns) {
      sections = sections.flatMap(s => s.split(pattern));
    }

    return sections.filter(s => s.trim().length > 10);
  }

  /**
   * Parse a single section into a requirement
   */
  private parseSection(section: string, index: number): ParsedRequirement | null {
    const type = this.detectType(section);
    const priority = this.detectPriority(section);
    const components = this.extractComponents(section);
    const acceptanceCriteria = this.extractAcceptanceCriteria(section);

    // Skip if section is too vague
    if (components.length === 0 && acceptanceCriteria.length === 0) {
      return null;
    }

    return {
      id: `REQ-${index + 1}`,
      description: section.slice(0, 200),
      type,
      priority,
      components,
      acceptanceCriteria,
      dependencies: []
    };
  }

  /**
   * Detect requirement type from content
   */
  private detectType(section: string): ParsedRequirement['type'] {
    const lower = section.toLowerCase();
    
    if (/\bfix|bug|error|issue|broken\b/.test(lower)) return 'bugfix';
    if (/\btest|spec|verify|assert\b/.test(lower)) return 'test';
    if (/\brefactor|cleanup|reorganize|rename\b/.test(lower)) return 'refactor';
    return 'feature';
  }

  /**
   * Detect priority from content
   */
  private detectPriority(section: string): ParsedRequirement['priority'] {
    const lower = section.toLowerCase();
    
    if (/\bcritical|urgent|blocking|must|essential\b/.test(lower)) return 'critical';
    if (/\bimportant|should|high priority\b/.test(lower)) return 'high';
    if (/\boptional|nice|could|low priority\b/.test(lower)) return 'low';
    return 'medium';
  }

  /**
   * Extract component names from section
   */
  private extractComponents(section: string): string[] {
    const components: string[] = [];
    
    // Match file-like patterns
    const filePattern = /[\w-]+\.(ts|tsx|js|jsx|py|rs|go|java|rb)/g;
    let match;
    while ((match = filePattern.exec(section)) !== null) {
      components.push(match[0]);
    }

    // Match camelCase/PascalCase identifiers that might be components
    const componentPattern = /\b([A-Z][a-zA-Z]+(?:Component|Service|Manager|Controller|Module|Handler))\b/g;
    while ((match = componentPattern.exec(section)) !== null) {
      components.push(match[1]);
    }

    // Match quoted strings that might be component names
    const quotedPattern = /['"`]([\w-]+)['"`]/g;
    while ((match = quotedPattern.exec(section)) !== null) {
      if (match[1].length > 2 && !components.includes(match[1])) {
        components.push(match[1]);
      }
    }

    return [...new Set(components)];
  }

  /**
   * Extract acceptance criteria from section
   */
  private extractAcceptanceCriteria(section: string): string[] {
    const criteria: string[] = [];
    
    // Look for "should", "must", "can" patterns
    const patterns = [
      /(?:should|must|can|will)\s+([^.;]+)/gi,
      /(?:when|if)\s+([^.;]+)/gi,
      /(?:acceptance criteria|criteria):?\s*([^.;]+)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(section)) !== null) {
        const criterion = match[1].trim();
        if (criterion.length > 10 && criterion.length < 200) {
          criteria.push(criterion);
        }
      }
    }

    return [...new Set(criteria)];
  }

  /**
   * Resolve dependencies between requirements
   */
  private resolveDependencies(requirements: ParsedRequirement[]): void {
    for (let i = 0; i < requirements.length; i++) {
      const req = requirements[i];
      
      for (let j = 0; j < requirements.length; j++) {
        if (i === j) continue;
        
        const other = requirements[j];
        
        // Check if this requirement references another
        if (req.description.toLowerCase().includes(other.description.toLowerCase().slice(0, 30))) {
          if (!req.dependencies.includes(other.id)) {
            req.dependencies.push(other.id);
          }
        }
      }
    }
  }

  /**
   * Create a default requirement when parsing fails
   */
  private createDefaultRequirement(description: string): ParsedRequirement {
    return {
      id: 'REQ-1',
      description: description.slice(0, 200),
      type: 'feature',
      priority: 'medium',
      components: [],
      acceptanceCriteria: ['Implementation is complete and functional'],
      dependencies: []
    };
  }
}
