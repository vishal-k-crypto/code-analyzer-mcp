/**
 * Context Injector Subsystem
 * Main entry point for context injection
 */

export { ContextAssembler } from './assembler.js';
export { 
  generateBoundedContextPrompt, 
  generateErrorFixPrompt, 
  generateNextTargetGuide 
} from './templates.js';
