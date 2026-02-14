/**
 * LLM Client
 * Provides LLM integration for requirement parsing and other AI tasks
 */

import type { LLMConfig } from '../utils/config.js';
import type { ParsedRequirement } from '../types/gap.js';

export interface LLMRequirementResponse {
  requirements: Array<{
    description: string;
    type: 'feature' | 'bugfix' | 'refactor' | 'test';
    priority: 'critical' | 'high' | 'medium' | 'low';
    components?: string[];
    acceptanceCriteria?: string[];
    dependencies?: string[];
  }>;
}

export class LLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * Parse a project goal into structured requirements using LLM
   */
  async parseRequirements(goalDescription: string): Promise<ParsedRequirement[]> {
    if (!this.config.apiKey) {
      throw new Error('LLM API key not configured');
    }

    const prompt = this.buildParsingPrompt(goalDescription);
    
    let response: LLMRequirementResponse;
    
    switch (this.config.provider) {
      case 'openai':
        response = await this.callOpenAI(prompt);
        break;
      case 'anthropic':
        response = await this.callAnthropic(prompt);
        break;
      case 'custom':
        response = await this.callCustomLLM(prompt);
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }

    // Transform LLM response to ParsedRequirement format
    return this.transformToParsedRequirements(response);
  }

  /**
   * Build the parsing prompt
   */
  private buildParsingPrompt(goalDescription: string): string {
    return `Parse the following project goal into structured requirements.

Goal Description:
"""${goalDescription}"""

Analyze this goal and extract:
1. Individual requirements (break down complex goals into atomic requirements)
2. Requirement type: feature (new functionality), bugfix (fixing issues), refactor (code improvement), or test (testing-related)
3. Priority: critical (blocking/must-have), high (important), medium (normal), or low (nice-to-have)
4. Components mentioned (file names, modules, classes, etc.)
5. Acceptance criteria (specific conditions that define when the requirement is met)
6. Dependencies between requirements (which requirements must be completed before others)

Respond with a JSON object in this exact format:
{
  "requirements": [
    {
      "description": "Clear, concise description of the requirement",
      "type": "feature|bugfix|refactor|test",
      "priority": "critical|high|medium|low",
      "components": ["file1.ts", "ComponentName", "module-name"],
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
      "dependencies": ["REQ-1", "REQ-2"]
    }
  ]
}

Important:
- Each requirement should be atomic and independently implementable
- Use "feature" for new functionality, "bugfix" for fixes, "refactor" for code improvements
- Dependencies should reference other requirement indices (0-based) within the same response
- If no components are explicitly mentioned, infer from context or leave empty
- Acceptance criteria should be testable and specific`;
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(prompt: string): Promise<LLMRequirementResponse> {
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: 'You are a precise requirements analyzer. Parse project goals into structured, actionable requirements. Always respond with valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    
    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI API');
    }

    return JSON.parse(content) as LLMRequirementResponse;
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropic(prompt: string): Promise<LLMRequirementResponse> {
    const baseUrl = this.config.baseUrl || 'https://api.anthropic.com/v1';
    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system: 'You are a precise requirements analyzer. Parse project goals into structured, actionable requirements. Always respond with valid JSON only, no markdown formatting.',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };
    
    const textContent = data.content.find(c => c.type === 'text')?.text;
    if (!textContent) {
      throw new Error('Empty response from Anthropic API');
    }

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = textContent.match(/```json\s*([\s\S]*?)```/) || 
                      textContent.match(/```\s*([\s\S]*?)```/) ||
                      [null, textContent];
    
    return JSON.parse(jsonMatch[1] || textContent) as LLMRequirementResponse;
  }

  /**
   * Call custom LLM API (OpenAI-compatible format)
   */
  private async callCustomLLM(prompt: string): Promise<LLMRequirementResponse> {
    if (!this.config.baseUrl) {
      throw new Error('Custom LLM provider requires LLM_BASE_URL environment variable');
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: 'You are a precise requirements analyzer. Parse project goals into structured, actionable requirements. Always respond with valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Custom LLM API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    
    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from Custom LLM API');
    }

    // Try to extract JSON from the response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || 
                      content.match(/```\s*([\s\S]*?)```/) ||
                      [null, content];
    
    return JSON.parse(jsonMatch[1] || content) as LLMRequirementResponse;
  }

  /**
   * Transform LLM response to ParsedRequirement format
   */
  private transformToParsedRequirements(response: LLMRequirementResponse): ParsedRequirement[] {
    if (!Array.isArray(response.requirements)) {
      throw new Error('Invalid LLM response: requirements array not found');
    }

    return response.requirements.map((req, index) => ({
      id: `REQ-${index + 1}`,
      description: req.description,
      type: req.type || 'feature',
      priority: req.priority || 'medium',
      components: req.components || [],
      acceptanceCriteria: req.acceptanceCriteria || [],
      dependencies: (req.dependencies || []).map(depId => {
        // Handle both numeric indices and REQ-XX format
        if (typeof depId === 'number' || /^\d+$/.test(String(depId))) {
          return `REQ-${parseInt(String(depId), 10) + 1}`;
        }
        return depId;
      })
    }));
  }
}
