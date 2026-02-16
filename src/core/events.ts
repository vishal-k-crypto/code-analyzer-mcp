/**
 * Event Emitter Types
 * Typed event system for orchestrator state transitions and lifecycle events
 */

import type { OrchestratorState, State, ErrorEntry, Task } from '../types/state.js';

/**
 * Event types emitted by the orchestrator
 */
export type OrchestratorEventType =
  // State machine events
  | 'state:transition'
  | 'state:enter'
  | 'state:exit'
  // Task lifecycle events
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:retry'
  // Goal events
  | 'goal:ingested'
  | 'goal:updated'
  // Error events
  | 'error:occurred'
  | 'error:recurring'
  // Score events
  | 'score:calculated'
  | 'score:threshold:reached'
  // Checkpoint events
  | 'checkpoint:created'
  | 'checkpoint:restored'
  // System events
  | 'system:initialized'
  | 'system:shutdown'
  | 'system:recovery';

/**
 * Base event interface
 */
export interface OrchestratorEvent {
  type: OrchestratorEventType;
  timestamp: Date;
  traceId: string;
}

/**
 * State transition event
 */
export interface StateTransitionEvent extends OrchestratorEvent {
  type: 'state:transition' | 'state:enter' | 'state:exit';
  from: State;
  to: State;
  state: OrchestratorState;
  duration?: number; // Duration in ms (for state:exit)
}

/**
 * Task lifecycle event
 */
export interface TaskEvent extends OrchestratorEvent {
  type: 'task:started' | 'task:completed' | 'task:failed' | 'task:retry';
  task: Task;
  state: OrchestratorState;
  attempt?: number;
  error?: Error;
  duration?: number;
}

/**
 * Goal event
 */
export interface GoalEvent extends OrchestratorEvent {
  type: 'goal:ingested' | 'goal:updated';
  goal: string;
  requirements: number;
  state: OrchestratorState;
}

/**
 * Error event
 */
export interface ErrorEvent extends OrchestratorEvent {
  type: 'error:occurred' | 'error:recurring';
  error: ErrorEntry;
  recurring: boolean;
  frequency?: number;
  state: OrchestratorState;
}

/**
 * Score event
 */
export interface ScoreEvent extends OrchestratorEvent {
  type: 'score:calculated' | 'score:threshold:reached';
  score: number;
  breakdown?: {
    requirementsCoverage: number;
    testPassRate: number;
    codeQuality: number;
    implementationCompleteness: number;
    penalties: number;
  };
  threshold?: number;
  state: OrchestratorState;
}

/**
 * Checkpoint event
 */
export interface CheckpointEvent extends OrchestratorEvent {
  type: 'checkpoint:created' | 'checkpoint:restored';
  checkpointId: string;
  state: OrchestratorState;
}

/**
 * System event
 */
export interface SystemEvent extends OrchestratorEvent {
  type: 'system:initialized' | 'system:shutdown' | 'system:recovery';
  state?: OrchestratorState;
  recoveryFrom?: string; // For recovery events
}

/**
 * Union type of all orchestrator events
 */
export type AnyOrchestratorEvent =
  | StateTransitionEvent
  | TaskEvent
  | GoalEvent
  | ErrorEvent
  | ScoreEvent
  | CheckpointEvent
  | SystemEvent;

/**
 * Event listener type
 */
export type EventListener<T extends OrchestratorEvent> = (event: T) => void | Promise<void>;

/**
 * Typed Event Emitter for Orchestrator
 */
export class OrchestratorEventEmitter {
  private listeners: Map<OrchestratorEventType, Set<EventListener<any>>> = new Map();
  private wildcardListeners: Set<EventListener<any>> = new Set();

  /**
   * Generate a trace ID for event correlation
   */
  generateTraceId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Subscribe to a specific event type
   */
  on<T extends OrchestratorEvent>(
    eventType: T['type'],
    listener: EventListener<T>
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(eventType)?.delete(listener);
    };
  }

  /**
   * Subscribe to all events (wildcard)
   */
  onAny(listener: EventListener<AnyOrchestratorEvent>): () => void {
    this.wildcardListeners.add(listener);
    return () => {
      this.wildcardListeners.delete(listener);
    };
  }

  /**
   * Subscribe once to a specific event type
   */
  once<T extends OrchestratorEvent>(
    eventType: T['type'],
    listener: EventListener<T>
  ): void {
    const onceWrapper = (event: T) => {
      this.off(eventType, onceWrapper);
      listener(event);
    };
    this.on(eventType, onceWrapper);
  }

  /**
   * Unsubscribe from a specific event type
   */
  off<T extends OrchestratorEvent>(
    eventType: T['type'],
    listener: EventListener<T>
  ): void {
    this.listeners.get(eventType)?.delete(listener);
  }

  /**
   * Emit an event
   */
  emit<T extends OrchestratorEvent>(event: T): void {
    // Add timestamp if not present
    if (!event.timestamp) {
      (event as any).timestamp = new Date();
    }

    // Call specific listeners
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in event listener for ${event.type}:`, error);
        }
      }
    }

    // Call wildcard listeners
    for (const listener of this.wildcardListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`Error in wildcard event listener:`, error);
      }
    }
  }

  /**
   * Emit a state transition event
   */
  emitStateTransition(
    from: State,
    to: State,
    state: OrchestratorState,
    traceId?: string
  ): void {
    this.emit({
      type: 'state:transition',
      timestamp: new Date(),
      traceId: traceId || this.generateTraceId(),
      from,
      to,
      state
    } as StateTransitionEvent);
  }

  /**
   * Emit a task event
   */
  emitTaskEvent(
    type: 'task:started' | 'task:completed' | 'task:failed' | 'task:retry',
    task: Task,
    state: OrchestratorState,
    options?: { attempt?: number; error?: Error; duration?: number; traceId?: string }
  ): void {
    this.emit({
      type,
      timestamp: new Date(),
      traceId: options?.traceId || this.generateTraceId(),
      task,
      state,
      attempt: options?.attempt,
      error: options?.error,
      duration: options?.duration
    } as TaskEvent);
  }

  /**
   * Emit a score event
   */
  emitScoreEvent(
    type: 'score:calculated' | 'score:threshold:reached',
    score: number,
    state: OrchestratorState,
    options?: {
      breakdown?: ScoreEvent['breakdown'];
      threshold?: number;
      traceId?: string;
    }
  ): void {
    this.emit({
      type,
      timestamp: new Date(),
      traceId: options?.traceId || this.generateTraceId(),
      score,
      state,
      breakdown: options?.breakdown,
      threshold: options?.threshold
    } as ScoreEvent);
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(eventType?: OrchestratorEventType): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
      this.wildcardListeners.clear();
    }
  }

  /**
   * Get count of listeners for an event type
   */
  listenerCount(eventType: OrchestratorEventType): number {
    return this.listeners.get(eventType)?.size || 0;
  }
}

// Export singleton instance for global events
export const globalEventEmitter = new OrchestratorEventEmitter();
