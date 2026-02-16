/**
 * Task Scheduler Module
 * Handles task scheduling and execution order optimization
 * 
 * Provides scheduling algorithms for:
 * - Topological sorting with priority weighting
 * - Parallel task identification
 * - Resource-aware scheduling
 * - Deadline-based prioritization
 */

import type { Task } from '../../types/state.js';

export interface ScheduledTask extends Task {
  scheduledStart?: Date;
  estimatedDuration?: number; // in minutes
  priorityScore: number;
  parallelGroup?: number;
}

export interface Schedule {
  tasks: ScheduledTask[];
  parallelGroups: Map<number, string[]>; // groupId -> taskIds
  estimatedTotalDuration: number;
  criticalPath: string[];
}

export interface SchedulingOptions {
  respectDependencies?: boolean;
  maxParallelTasks?: number;
  priorityWeight?: number;
  deadlineWeight?: number;
  durationWeight?: number;
}

/**
 * Task scheduler for optimizing execution order
 */
export class TaskScheduler {
  private options: Required<SchedulingOptions>;

  constructor(options: SchedulingOptions = {}) {
    this.options = {
      respectDependencies: true,
      maxParallelTasks: 1, // Sequential by default
      priorityWeight: 0.5,
      deadlineWeight: 0.3,
      durationWeight: 0.2,
      ...options
    };
  }

  /**
   * Create an optimized schedule for tasks
   */
  schedule(tasks: Task[]): Schedule {
    // Calculate priority scores
    const scoredTasks = tasks.map(t => this.calculatePriorityScore(t));

    // Build dependency graph
    const dependencyGraph = this.buildDependencyGraph(scoredTasks);

    // Perform topological sort with priority weighting
    const sorted = this.topologicalSort(scoredTasks, dependencyGraph);

    // Identify parallelizable tasks
    const parallelGroups = this.identifyParallelGroups(sorted, dependencyGraph);

    // Calculate critical path
    const criticalPath = this.calculateCriticalPath(sorted, dependencyGraph);

    // Estimate total duration
    const estimatedTotalDuration = this.estimateTotalDuration(sorted, parallelGroups);

    return {
      tasks: sorted,
      parallelGroups,
      estimatedTotalDuration,
      criticalPath
    };
  }

  /**
   * Calculate priority score for a task
   */
  private calculatePriorityScore(task: Task): ScheduledTask {
    const priorityWeights: Record<string, number> = {
      critical: 100,
      high: 75,
      medium: 50,
      low: 25
    };

    // Base priority from task metadata
    const basePriority = priorityWeights[task.context.expectedOutput === 'New implementation files' ? 'high' : 'medium'] || 50;

    // Phase weight (earlier phases are more critical)
    const phaseWeight = (6 - task.phase) * 10;

    // Attempt penalty (tasks with more attempts get slight boost to finish them)
    const attemptBoost = Math.min(task.attempts * 5, 20);

    // Calculate final score
    const priorityScore = basePriority + phaseWeight + attemptBoost;

    return {
      ...task,
      priorityScore,
      estimatedDuration: this.estimateTaskDuration(task)
    };
  }

  /**
   * Estimate task duration based on complexity
   */
  private estimateTaskDuration(task: Task): number {
    // Base duration in minutes
    const baseDuration = 30;

    // Factor in number of acceptance criteria
    const criteriaComplexity = task.acceptanceCriteria.length * 10;

    // Factor in number of relevant files
    const fileComplexity = task.context.relevantFiles.length * 5;

    // Factor in attempts (retries tend to be faster)
    const attemptFactor = Math.max(0.5, 1 - task.attempts * 0.2);

    return (baseDuration + criteriaComplexity + fileComplexity) * attemptFactor;
  }

  /**
   * Build dependency graph
   */
  private buildDependencyGraph(tasks: ScheduledTask[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    for (const task of tasks) {
      graph.set(task.id, new Set(task.dependencies));
    }

    return graph;
  }

  /**
   * Perform topological sort with priority weighting
   * Uses Kahn's algorithm with priority queue
   */
  private topologicalSort(
    tasks: ScheduledTask[],
    dependencyGraph: Map<string, Set<string>>
  ): ScheduledTask[] {
    if (!this.options.respectDependencies) {
      // Just sort by priority score
      return [...tasks].sort((a, b) => b.priorityScore - a.priorityScore);
    }

    const result: ScheduledTask[] = [];
    const inDegree = new Map<string, number>();
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    // Calculate in-degrees
    for (const [taskId, deps] of dependencyGraph) {
      inDegree.set(taskId, deps.size);
    }

    // Initialize queue with tasks that have no dependencies
    const queue: string[] = [];
    for (const [taskId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    // Process queue
    while (queue.length > 0) {
      // Sort queue by priority score (highest first)
      queue.sort((a, b) => {
        const taskA = taskMap.get(a)!;
        const taskB = taskMap.get(b)!;
        
        // Primary: priority score
        if (taskB.priorityScore !== taskA.priorityScore) {
          return taskB.priorityScore - taskA.priorityScore;
        }
        
        // Secondary: phase number
        if (taskA.phase !== taskB.phase) {
          return taskA.phase - taskB.phase;
        }
        
        // Tertiary: creation time
        return taskA.createdAt.getTime() - taskB.createdAt.getTime();
      });

      const taskId = queue.shift()!;
      const task = taskMap.get(taskId)!;
      
      result.push(task);

      // Update in-degrees for dependent tasks
      for (const [otherId, deps] of dependencyGraph) {
        if (deps.has(taskId)) {
          const newDegree = (inDegree.get(otherId) || 0) - 1;
          inDegree.set(otherId, newDegree);
          
          if (newDegree === 0) {
            queue.push(otherId);
          }
        }
      }
    }

    // Check for remaining tasks (cycle detection)
    if (result.length !== tasks.length) {
      const remaining = tasks.filter(t => !result.some(r => r.id === t.id));
      // Add remaining tasks with cleared dependencies
      for (const task of remaining) {
        result.push({ ...task, dependencies: [] });
      }
    }

    return result;
  }

  /**
   * Identify groups of tasks that can run in parallel
   */
  private identifyParallelGroups(
    sortedTasks: ScheduledTask[],
    dependencyGraph: Map<string, Set<string>>
  ): Map<number, string[]> {
    const groups = new Map<number, string[]>();
    
    if (this.options.maxParallelTasks <= 1) {
      // Sequential - each task is its own group
      sortedTasks.forEach((task, index) => {
        groups.set(index, [task.id]);
        task.parallelGroup = index;
      });
      return groups;
    }

    // Group tasks by level in dependency graph
    const levels = this.calculateLevels(sortedTasks, dependencyGraph);
    let currentGroup = 0;

    for (const [, taskIds] of levels) {
      // Split large levels into multiple groups if needed
      for (let i = 0; i < taskIds.length; i += this.options.maxParallelTasks) {
        const groupTasks = taskIds.slice(i, i + this.options.maxParallelTasks);
        groups.set(currentGroup, groupTasks);
        
        for (const taskId of groupTasks) {
          const task = sortedTasks.find(t => t.id === taskId);
          if (task) {
            task.parallelGroup = currentGroup;
          }
        }
        
        currentGroup++;
      }
    }

    return groups;
  }

  /**
   * Calculate levels in dependency graph
   */
  private calculateLevels(
    tasks: ScheduledTask[],
    dependencyGraph: Map<string, Set<string>>
  ): Map<number, string[]> {
    const levels = new Map<number, string[]>();
    const taskLevels = new Map<string, number>();

    // Calculate level for each task
    for (const task of tasks) {
      const level = this.calculateTaskLevel(task.id, dependencyGraph, taskLevels);
      if (!levels.has(level)) {
        levels.set(level, []);
      }
      levels.get(level)!.push(task.id);
    }

    return levels;
  }

  /**
   * Calculate level for a single task (recursive with memoization)
   */
  private calculateTaskLevel(
    taskId: string,
    dependencyGraph: Map<string, Set<string>>,
    memo: Map<string, number>
  ): number {
    if (memo.has(taskId)) {
      return memo.get(taskId)!;
    }

    const deps = dependencyGraph.get(taskId) || new Set();
    if (deps.size === 0) {
      memo.set(taskId, 0);
      return 0;
    }

    let maxDepLevel = -1;
    for (const depId of deps) {
      const depLevel = this.calculateTaskLevel(depId, dependencyGraph, memo);
      maxDepLevel = Math.max(maxDepLevel, depLevel);
    }

    const level = maxDepLevel + 1;
    memo.set(taskId, level);
    return level;
  }

  /**
   * Calculate critical path (longest path in dependency graph)
   */
  private calculateCriticalPath(
    tasks: ScheduledTask[],
    dependencyGraph: Map<string, Set<string>>
  ): string[] {
    const distances = new Map<string, number>();
    const predecessors = new Map<string, string | null>();

    // Initialize
    for (const task of tasks) {
      distances.set(task.id, task.estimatedDuration || 30);
      predecessors.set(task.id, null);
    }

    // Relax edges
    for (const task of tasks) {
      const taskDist = distances.get(task.id)!;
      
      // Find tasks that depend on this task
      for (const [otherId, deps] of dependencyGraph) {
        if (deps.has(task.id)) {
          const otherDist = distances.get(otherId)!;
          const newDist = taskDist + (tasks.find(t => t.id === otherId)?.estimatedDuration || 30);
          
          if (newDist > otherDist) {
            distances.set(otherId, newDist);
            predecessors.set(otherId, task.id);
          }
        }
      }
    }

    // Find task with maximum distance
    let maxDist = 0;
    let endTask: string | null = null;
    
    for (const [taskId, dist] of distances) {
      if (dist > maxDist) {
        maxDist = dist;
        endTask = taskId;
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let current: string | null = endTask;
    
    while (current !== null) {
      path.unshift(current);
      current = predecessors.get(current) || null;
    }

    return path;
  }

  /**
   * Estimate total duration considering parallel execution
   */
  private estimateTotalDuration(
    tasks: ScheduledTask[],
    parallelGroups: Map<number, string[]>
  ): number {
    let totalDuration = 0;

    for (const [_, taskIds] of parallelGroups) {
      // Duration of parallel group is max duration of tasks in group
      const groupDuration = Math.max(...taskIds.map(id => {
        const task = tasks.find(t => t.id === id);
        return task?.estimatedDuration || 30;
      }));
      
      totalDuration += groupDuration;
    }

    return totalDuration;
  }

  /**
   * Update scheduling options
   */
  updateOptions(options: SchedulingOptions): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current scheduling options
   */
  getOptions(): Required<SchedulingOptions> {
    return { ...this.options };
  }
}

/**
 * Simple round-robin scheduler for basic use cases
 */
export function createRoundRobinSchedule(tasks: Task[]): Schedule {
  const sorted = [...tasks].sort((a, b) => {
    // Sort by phase first
    if (a.phase !== b.phase) return a.phase - b.phase;
    // Then by creation time
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const groups = new Map<number, string[]>();
  sorted.forEach((task, index) => {
    groups.set(index, [task.id]);
  });

  return {
    tasks: sorted.map(t => ({ ...t, priorityScore: 0 })),
    parallelGroups: groups,
    estimatedTotalDuration: sorted.length * 30,
    criticalPath: sorted.map(t => t.id)
  };
}
