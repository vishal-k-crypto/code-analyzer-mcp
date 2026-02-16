/**
 * State Management Types
 * Core type definitions for the orchestrator state machine
 */

export type State = 
  | 'IDLE'
  | 'ANALYZE_GAPS'
  | 'PLAN_ROADMAP'
  | 'EXECUTE_SESSION'
  | 'VERIFY_OUTPUT'
  | 'SCORE_PROJECT'
  | 'COMPLETE';

export interface ProjectGoal {
  id: string;
  description: string;
  requirements: Requirement[];
  constraints: Constraint[];
  targetMetrics: Metrics;
  createdAt: Date;
  updatedAt: Date;
}

export interface Requirement {
  id: string;
  description: string;
  type: 'feature' | 'bugfix' | 'refactor' | 'test';
  priority: 'critical' | 'high' | 'medium' | 'low';
  components: string[];
  acceptanceCriteria: string[];
  dependencies: string[];
  weight: number;
  verified: boolean;
  partiallyMet: boolean;
}

export interface Constraint {
  id: string;
  description: string;
  type: 'technical' | 'business' | 'legal';
}

export interface Metrics {
  qualityThreshold: number;
  maxIterations: number;
  timeoutMinutes: number;
}

export interface Progress {
  currentState: State;
  completedTasks: Task[];
  currentTask: Task | null;
  completionScore: number;
  lastVerifiedAt: Date | null;
}

export interface TaskQueue {
  phases: Phase[];
  pending: Task[];
  inProgress: Task | null;
  failed: Task[];
  dependencies: Map<string, string[]>;
}

export interface Phase {
  number: number;
  title: string;
  description: string;
  tasks: Task[];
}

export interface Task {
  id: string;
  phase: number;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  context: BoundedContext;
  verificationCommands: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  attempts: number;
  createdAt: Date;
  completedAt: Date | null;
  error?: ErrorEntry;
  /** IDs of tasks that must complete before this task */
  dependencies: string[];
  /** Requirement ID this task originated from (for tracking explicit dependencies) */
  requirementId?: string;
}

export interface FileReference {
  path: string;
  relevance: number;
}

export interface BoundedContext {
  relevantFiles: string[];
  forbiddenFiles: string[];
  instructions: string;
  expectedOutput: string;
  essentialFiles?: FileReference[];
  referenceFiles?: FileReference[];
  testCommands?: string[];
}

export interface ErrorLog {
  entries: ErrorEntry[];
  patterns: ErrorPattern[];
  retryCount: Map<string, number>;
}

export interface ErrorEntry {
  id: string;
  taskId: string;
  type: 'syntax' | 'type' | 'runtime' | 'test' | 'lint' | 'timeout' | 'crash' | 'dependency';
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  context?: string;
  timestamp: Date;
  resolved: boolean;
}

export interface ErrorPattern {
  pattern: string;
  frequency: number;
  affectedTasks: string[];
  suggestions: string[];
}

export interface OrchestratorState {
  projectGoal: ProjectGoal | null;
  progress: Progress;
  taskQueue: TaskQueue;
  errorLog: ErrorLog;
  projectPath: string;
}

export interface ScoreHistory {
  entries: ScoreEntry[];
  trend: 'improving' | 'stable' | 'regressing';
  velocity: number;
}

export interface ScoreEntry {
  timestamp: Date;
  score: number;
  breakdown: ScoreBreakdown;
  taskCompleted: string;
}

export interface ScoreBreakdown {
  requirementsCoverage: number;
  testPassRate: number;
  codeQuality: number;
  implementationCompleteness: number;
  penalties: number;
}

export interface ProgressAnalysis {
  trend: 'improving' | 'stable' | 'regressing';
  velocity: number;
  estimatedCompletion: Date | null;
}

export interface QualityGate {
  criteria: {
    requirementsCoverage: { min: number };
    testPassRate: { min: number };
    lintErrorRate: { max: number };
    typeErrorRate: { max: number };
    taskCompletion: { min: number };
  };
  bonuses: {
    perfectTests: number;
    zeroLint: number;
    earlyCompletion: number;
  };
}

// Constants
export const QUALITY_THRESHOLD = 85;

export const DEFAULT_QUALITY_GATE: QualityGate = {
  criteria: {
    requirementsCoverage: { min: 0.85 },
    testPassRate: { min: 0.90 },
    lintErrorRate: { max: 0.02 },
    typeErrorRate: { max: 0.00 },
    taskCompletion: { min: 0.80 }
  },
  bonuses: {
    perfectTests: 5,
    zeroLint: 3,
    earlyCompletion: 5
  }
};

export const MAX_RETRY_ATTEMPTS: Record<string, number> = {
  syntax: 5,
  test: 3,
  timeout: 2,
  crash: 3,
  dependency: 1
};
