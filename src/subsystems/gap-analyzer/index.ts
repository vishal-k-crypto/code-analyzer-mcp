/**
 * Gap Analyzer Subsystem
 * Main entry point for gap detection and analysis
 */

export { GapDetector } from './detector.js';
export { RequirementParser } from './parser.js';
export type { ParseResult } from './parser.js';
export { SemanticCodeAnalyzer } from './semantic-analyzer.js';
export type { SemanticMatch, MatchLocation, ComponentDefinition } from './semantic-analyzer.js';
