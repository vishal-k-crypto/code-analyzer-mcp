/**
 * State Machine
 * Implements the orchestration state machine
 */

import type { State, OrchestratorState, Task, ErrorEntry } from '../types/state.js';
import { QUALITY_THRESHOLD } from '../types/state.js';

export type StateTransition = 
  | { type: 'GOAL_INGESTED' }
  | { type: 'GAPS_DETECTED' }
  | { type: 'ROADMAP_CREATED' }
  | { type: 'TASK_ASSIGNED'; task: Task }
  | { type: 'TASK_COMPLETED'; taskId: string }
  | { type: 'TASK_FAILED'; taskId: string; error: ErrorEntry }
  | { type: 'VERIFICATION_PASSED' }
  | { type: 'VERIFICATION_FAILED'; error: ErrorEntry }
  | { type: 'SCORE_CALCULATED'; score: number }
  | { type: 'FORCE_RETRY'; taskId: string }
  | { type: 'RESET' };

export class StateMachine {
  /**
   * Get next state based on current state and transition
   */
  getNextState(currentState: State, transition: StateTransition): State {
    switch (currentState) {
      case 'IDLE':
        if (transition.type === 'GOAL_INGESTED') {
          return 'ANALYZE_GAPS';
        }
        return currentState;

      case 'ANALYZE_GAPS':
        if (transition.type === 'GAPS_DETECTED') {
          return 'PLAN_ROADMAP';
        }
        if (transition.type === 'RESET') {
          return 'IDLE';
        }
        return currentState;

      case 'PLAN_ROADMAP':
        if (transition.type === 'ROADMAP_CREATED') {
          return 'EXECUTE_SESSION';
        }
        if (transition.type === 'RESET') {
          return 'IDLE';
        }
        return currentState;

      case 'EXECUTE_SESSION':
        if (transition.type === 'TASK_ASSIGNED') {
          return 'EXECUTE_SESSION'; // Stay in execute while task is active
        }
        if (transition.type === 'TASK_COMPLETED') {
          return 'VERIFY_OUTPUT';
        }
        if (transition.type === 'TASK_FAILED') {
          // If max retries not exceeded, stay to retry
          return 'EXECUTE_SESSION';
        }
        if (transition.type === 'VERIFICATION_PASSED') {
          return 'SCORE_PROJECT';
        }
        if (transition.type === 'RESET') {
          return 'IDLE';
        }
        return currentState;

      case 'VERIFY_OUTPUT':
        if (transition.type === 'VERIFICATION_PASSED') {
          return 'SCORE_PROJECT';
        }
        if (transition.type === 'VERIFICATION_FAILED') {
          return 'EXECUTE_SESSION'; // Go back to fix
        }
        if (transition.type === 'RESET') {
          return 'IDLE';
        }
        return currentState;

      case 'SCORE_PROJECT':
        if (transition.type === 'SCORE_CALCULATED') {
          if (transition.score >= QUALITY_THRESHOLD) {
            return 'COMPLETE';
          }
          // Need more work - check if there are pending tasks
          return 'EXECUTE_SESSION';
        }
        if (transition.type === 'RESET') {
          return 'IDLE';
        }
        return currentState;

      case 'COMPLETE':
        if (transition.type === 'RESET') {
          return 'IDLE';
        }
        return currentState;

      default:
        return currentState;
    }
  }

  /**
   * Check if transition is valid
   */
  isValidTransition(currentState: State, transition: StateTransition): boolean {
    const nextState = this.getNextState(currentState, transition);
    return nextState !== currentState || 
           (transition.type === 'TASK_ASSIGNED' && currentState === 'EXECUTE_SESSION');
  }

  /**
   * Get valid transitions for a state
   */
  getValidTransitions(state: State): string[] {
    switch (state) {
      case 'IDLE':
        return ['GOAL_INGESTED'];
      case 'ANALYZE_GAPS':
        return ['GAPS_DETECTED', 'RESET'];
      case 'PLAN_ROADMAP':
        return ['ROADMAP_CREATED', 'RESET'];
      case 'EXECUTE_SESSION':
        return ['TASK_ASSIGNED', 'TASK_COMPLETED', 'TASK_FAILED', 'VERIFICATION_PASSED', 'RESET'];
      case 'VERIFY_OUTPUT':
        return ['VERIFICATION_PASSED', 'VERIFICATION_FAILED', 'RESET'];
      case 'SCORE_PROJECT':
        return ['SCORE_CALCULATED', 'RESET'];
      case 'COMPLETE':
        return ['RESET'];
      default:
        return [];
    }
  }
}
