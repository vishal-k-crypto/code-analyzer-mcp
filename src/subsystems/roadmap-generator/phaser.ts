/**
 * Phaser Module
 * Handles task phase assignment and phase-based task grouping
 * 
 * Implements 5-phase task categorization:
 * - Phase 1: Foundation (dependencies, config)
 * - Phase 2: Fix Broken (syntax errors)
 * - Phase 3: Core Features (critical priority)
 * - Phase 4: Complete Partial
 * - Phase 5: Tests & Polish
 */

import type { Gap } from '../../types/gap.js';
import type { Task, Phase } from '../../types/state.js';

export type PhaseNumber = 1 | 2 | 3 | 4 | 5;

export interface PhaseDefinition {
  number: PhaseNumber;
  title: string;
  description: string;
  gapTypes: Gap['type'][];
  priorities: ('critical' | 'high' | 'medium' | 'low')[];
}

export interface PhaseAssignment {
  phase: PhaseNumber;
  reason: string;
  dependencies: string[];
}

/**
 * Phase definitions with their criteria
 */
export const PHASE_DEFINITIONS: PhaseDefinition[] = [
  {
    number: 1,
    title: 'Foundation',
    description: 'Dependency resolution and configuration setup',
    gapTypes: ['MISSING_DEPENDENCY'],
    priorities: ['critical', 'high', 'medium', 'low']
  },
  {
    number: 2,
    title: 'Fix Broken',
    description: 'Syntax errors and type issues',
    gapTypes: ['SYNTAX_ERROR'],
    priorities: ['critical', 'high', 'medium', 'low']
  },
  {
    number: 3,
    title: 'Core Features',
    description: 'Critical missing implementations',
    gapTypes: ['MISSING_IMPLEMENTATION'],
    priorities: ['critical']
  },
  {
    number: 4,
    title: 'Complete Partial',
    description: 'Partial implementations and improvements',
    gapTypes: ['PARTIAL_IMPLEMENTATION', 'MISSING_IMPLEMENTATION'],
    priorities: ['high', 'medium']
  },
  {
    number: 5,
    title: 'Tests & Polish',
    description: 'Test fixes and final polish',
    gapTypes: ['TEST_FAILURE', 'MISSING_IMPLEMENTATION'],
    priorities: ['low', 'medium']
  }
];

/**
 * Task phaser for assigning tasks to phases
 */
export class TaskPhaser {
  private phaseDefinitions: PhaseDefinition[];

  constructor(phaseDefinitions: PhaseDefinition[] = PHASE_DEFINITIONS) {
    this.phaseDefinitions = phaseDefinitions;
  }

  /**
   * Assign a task to the appropriate phase based on gap type and priority
   */
  assignPhase(gap: Gap): PhaseAssignment {
    // Find matching phase based on gap type
    for (const phase of this.phaseDefinitions) {
      if (phase.gapTypes.includes(gap.type)) {
        // Check priority match
        const gapPriority = gap.priority || gap.requirement?.priority || 'medium';
        if (phase.priorities.includes(gapPriority)) {
          return {
            phase: phase.number,
            reason: `Gap type '${gap.type}' with priority '${gapPriority}' maps to ${phase.title}`,
            dependencies: this.inferDependencies(gap, phase.number)
          };
        }
      }
    }

    // Default to phase 4 for unmatched gaps
    return {
      phase: 4,
      reason: `Default phase for gap type '${gap.type}'`,
      dependencies: this.inferDependencies(gap, 4)
    };
  }

  /**
   * Infer dependencies based on gap characteristics
   */
  private inferDependencies(gap: Gap, assignedPhase: PhaseNumber): string[] {
    const dependencies: string[] = [];

    // Add explicit requirement dependencies
    if (gap.requirement?.dependencies) {
      dependencies.push(...gap.requirement.dependencies);
    }

    // Phase 1 tasks are foundational - no dependencies
    if (assignedPhase === 1) {
      return dependencies;
    }

    // Phase 2+ tasks implicitly depend on all Phase 1 tasks
    // Phase 3+ tasks implicitly depend on all Phase 1 and 2 tasks
    // etc.
    for (let p = 1; p < assignedPhase; p++) {
      dependencies.push(`phase-${p}-complete`);
    }

    return [...new Set(dependencies)];
  }

  /**
   * Group tasks by phase
   */
  groupByPhase(tasks: Task[]): Map<PhaseNumber, Task[]> {
    const groups = new Map<PhaseNumber, Task[]>();

    for (const task of tasks) {
      const phase = task.phase as PhaseNumber;
      if (!groups.has(phase)) {
        groups.set(phase, []);
      }
      groups.get(phase)!.push(task);
    }

    // Sort tasks within each phase by priority and creation time
    for (const [, phaseTasks] of groups) {
      phaseTasks.sort((a, b) => {
        // Priority order
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const priorityDiff = priorityOrder[getTaskPriority(a)] - priorityOrder[getTaskPriority(b)];
        
        if (priorityDiff !== 0) return priorityDiff;
        
        // Creation time
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
    }

    return groups;
  }

  /**
   * Build phase objects from grouped tasks
   */
  buildPhases(taskGroups: Map<PhaseNumber, Task[]>): Phase[] {
    const phases: Phase[] = [];

    for (const [number, tasks] of taskGroups) {
      const definition = this.phaseDefinitions.find(p => p.number === number);
      
      phases.push({
        number,
        title: definition?.title || `Phase ${number}`,
        description: definition?.description || `Tasks for phase ${number}`,
        tasks
      });
    }

    // Sort by phase number
    phases.sort((a, b) => a.number - b.number);

    return phases;
  }

  /**
   * Validate phase ordering - ensure no task depends on a later phase
   */
  validatePhaseOrdering(tasks: Task[]): Array<{ task: Task; issue: string }> {
    const issues: Array<{ task: Task; issue: string }> = [];
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    for (const task of tasks) {
      for (const depId of task.dependencies) {
        const depTask = taskMap.get(depId);
        if (depTask && depTask.phase > task.phase) {
          issues.push({
            task,
            issue: `Task depends on '${depId}' which is in later phase (${depTask.phase} > ${task.phase})`
          });
        }
      }
    }

    return issues;
  }

  /**
   * Get phase info for a task
   */
  getPhaseInfo(phaseNumber: PhaseNumber): PhaseDefinition | undefined {
    return this.phaseDefinitions.find(p => p.number === phaseNumber);
  }

  /**
   * Check if a task can be moved to a different phase
   */
  canMovePhase(task: Task, newPhase: PhaseNumber, allTasks: Task[]): { allowed: boolean; reason: string } {
    // Check dependencies - can't move to phase earlier than dependencies
    for (const depId of task.dependencies) {
      const depTask = allTasks.find(t => t.id === depId);
      if (depTask && depTask.phase > newPhase) {
        return {
          allowed: false,
          reason: `Task depends on ${depId} which is in phase ${depTask.phase}`
        };
      }
    }

    // Check dependents - can't move to phase later than dependent tasks
    for (const otherTask of allTasks) {
      if (otherTask.dependencies.includes(task.id) && otherTask.phase < newPhase) {
        return {
          allowed: false,
          reason: `Task ${otherTask.id} depends on this task and is in phase ${otherTask.phase}`
        };
      }
    }

    return { allowed: true, reason: 'Can be moved' };
  }

  /**
   * Estimate phase completion based on task status
   */
  estimatePhaseCompletion(tasks: Task[]): Map<PhaseNumber, { completed: number; total: number; percentage: number }> {
    const completion = new Map<PhaseNumber, { completed: number; total: number; percentage: number }>();

    for (const task of tasks) {
      const phase = task.phase as PhaseNumber;
      
      if (!completion.has(phase)) {
        completion.set(phase, { completed: 0, total: 0, percentage: 0 });
      }
      
      const stats = completion.get(phase)!;
      stats.total++;
      
      if (task.status === 'completed') {
        stats.completed++;
      }
    }

    // Calculate percentages
    for (const stats of completion.values()) {
      stats.percentage = stats.total > 0 ? (stats.completed / stats.total) * 100 : 0;
    }

    return completion;
  }

  /**
   * Get next incomplete phase
   */
  getNextPhase(tasks: Task[]): PhaseNumber | null {
    const completion = this.estimatePhaseCompletion(tasks);
    
    const phases = Array.from(completion.entries()).sort((a, b) => a[0] - b[0]);
    
    for (const [phaseNum, stats] of phases) {
      if (stats.percentage < 100) {
        return phaseNum;
      }
    }

    return null;
  }

  /**
   * Update phase definitions
   */
  updatePhaseDefinitions(definitions: PhaseDefinition[]): void {
    this.phaseDefinitions = definitions;
  }

  /**
   * Get all phase definitions
   */
  getPhaseDefinitions(): PhaseDefinition[] {
    return [...this.phaseDefinitions];
  }
}

/**
 * Helper function to get task priority
 */
function getTaskPriority(task: Task): 'critical' | 'high' | 'medium' | 'low' {
  // Extract from task description/title
  const text = (task.title + ' ' + task.description).toLowerCase();
  
  if (text.includes('critical') || text.includes('foundational')) return 'critical';
  if (text.includes('high') || text.includes('important')) return 'high';
  if (text.includes('low') || text.includes('minor')) return 'low';
  
  // Default based on phase
  if (task.phase === 1) return 'critical';
  if (task.phase === 2) return 'high';
  if (task.phase === 5) return 'low';
  
  return 'medium';
}

/**
 * Create a phase filter for tasks
 */
export function createPhaseFilter(phaseNumber: PhaseNumber | PhaseNumber[]) {
  const phases = Array.isArray(phaseNumber) ? phaseNumber : [phaseNumber];
  return (task: Task) => phases.includes(task.phase as PhaseNumber);
}

/**
 * Get phase transition rules
 */
export function getPhaseTransitionRules(): Array<{ from: PhaseNumber; to: PhaseNumber; condition: string }> {
  return [
    { from: 1, to: 2, condition: 'All foundation tasks complete' },
    { from: 2, to: 3, condition: 'No syntax errors remaining' },
    { from: 3, to: 4, condition: 'All critical features implemented' },
    { from: 4, to: 5, condition: 'Core implementation complete' },
    { from: 5, to: 1, condition: 'All tests passing and polished' }
  ];
}
