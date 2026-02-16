/**
 * Context Injector Subsystem
 * Main entry point for context injection
 */

export { ContextAssembler } from './assembler.js';
export { 
  FileScorer, 
  quickRelevanceScore, 
  extractFileReferences,
  DEFAULT_SIGNALS,
  type ScoringSignals,
  type ScoringOptions
} from './file-scorer.js';
export { 
  generateBoundedContextPrompt, 
  generateErrorFixPrompt, 
  generateNextTargetGuide 
} from './templates.js';
