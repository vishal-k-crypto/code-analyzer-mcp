/**
 * State Machine Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { StateMachine } from '../../src/core/state-machine.js';
import type { State } from '../../src/types/state.js';

describe('StateMachine', () => {
  const machine = new StateMachine();

  describe('getNextState', () => {
    it('should transition from IDLE to ANALYZE_GAPS on GOAL_INGESTED', () => {
      const result = machine.getNextState('IDLE', { type: 'GOAL_INGESTED' });
      expect(result).toBe('ANALYZE_GAPS');
    });

    it('should stay in IDLE on invalid transition', () => {
      const result = machine.getNextState('IDLE', { type: 'TASK_COMPLETED' as any });
      expect(result).toBe('IDLE');
    });

    it('should transition from ANALYZE_GAPS to PLAN_ROADMAP on GAPS_DETECTED', () => {
      const result = machine.getNextState('ANALYZE_GAPS', { type: 'GAPS_DETECTED' });
      expect(result).toBe('PLAN_ROADMAP');
    });

    it('should transition from ANALYZE_GAPS to IDLE on RESET', () => {
      const result = machine.getNextState('ANALYZE_GAPS', { type: 'RESET' });
      expect(result).toBe('IDLE');
    });

    it('should transition from PLAN_ROADMAP to EXECUTE_SESSION on ROADMAP_CREATED', () => {
      const result = machine.getNextState('PLAN_ROADMAP', { type: 'ROADMAP_CREATED' });
      expect(result).toBe('EXECUTE_SESSION');
    });

    it('should stay in EXECUTE_SESSION on TASK_ASSIGNED', () => {
      const result = machine.getNextState('EXECUTE_SESSION', { 
        type: 'TASK_ASSIGNED', 
        task: { id: 'test', title: 'Test' } as any 
      });
      expect(result).toBe('EXECUTE_SESSION');
    });

    it('should transition from EXECUTE_SESSION to VERIFY_OUTPUT on TASK_COMPLETED', () => {
      const result = machine.getNextState('EXECUTE_SESSION', { 
        type: 'TASK_COMPLETED', 
        taskId: 'test' 
      });
      expect(result).toBe('VERIFY_OUTPUT');
    });

    it('should stay in EXECUTE_SESSION on TASK_FAILED', () => {
      const result = machine.getNextState('EXECUTE_SESSION', { 
        type: 'TASK_FAILED', 
        taskId: 'test',
        error: { id: 'err', message: 'Error' } as any
      });
      expect(result).toBe('EXECUTE_SESSION');
    });

    it('should transition from VERIFY_OUTPUT to EXECUTE_SESSION on VERIFICATION_FAILED', () => {
      const result = machine.getNextState('VERIFY_OUTPUT', { 
        type: 'VERIFICATION_FAILED',
        error: { id: 'err', message: 'Error' } as any
      });
      expect(result).toBe('EXECUTE_SESSION');
    });

    it('should transition from VERIFY_OUTPUT to SCORE_PROJECT on VERIFICATION_PASSED', () => {
      const result = machine.getNextState('VERIFY_OUTPUT', { type: 'VERIFICATION_PASSED' });
      expect(result).toBe('SCORE_PROJECT');
    });

    it('should transition from SCORE_PROJECT to COMPLETE when score >= 85', () => {
      const result = machine.getNextState('SCORE_PROJECT', { 
        type: 'SCORE_CALCULATED', 
        score: 90 
      });
      expect(result).toBe('COMPLETE');
    });

    it('should transition from SCORE_PROJECT to EXECUTE_SESSION when score < 85', () => {
      const result = machine.getNextState('SCORE_PROJECT', { 
        type: 'SCORE_CALCULATED', 
        score: 70 
      });
      expect(result).toBe('EXECUTE_SESSION');
    });

    it('should stay in COMPLETE on invalid transition', () => {
      const result = machine.getNextState('COMPLETE', { type: 'TASK_COMPLETED' as any });
      expect(result).toBe('COMPLETE');
    });

    it('should transition from any state to IDLE on RESET', () => {
      const states: State[] = ['ANALYZE_GAPS', 'PLAN_ROADMAP', 'EXECUTE_SESSION', 'VERIFY_OUTPUT', 'SCORE_PROJECT', 'COMPLETE'];
      for (const state of states) {
        const result = machine.getNextState(state, { type: 'RESET' });
        expect(result).toBe('IDLE');
      }
    });
  });

  describe('isValidTransition', () => {
    it('should return true for valid transition', () => {
      const result = machine.isValidTransition('IDLE', { type: 'GOAL_INGESTED' });
      expect(result).toBe(true);
    });

    it('should return false for invalid transition', () => {
      const result = machine.isValidTransition('IDLE', { type: 'TASK_COMPLETED' as any });
      expect(result).toBe(false);
    });

    it('should return true for TASK_ASSIGNED in EXECUTE_SESSION (same state)', () => {
      const result = machine.isValidTransition('EXECUTE_SESSION', { 
        type: 'TASK_ASSIGNED', 
        task: { id: 'test' } as any 
      });
      expect(result).toBe(true);
    });
  });

  describe('getValidTransitions', () => {
    it('should return correct transitions for IDLE', () => {
      const transitions = machine.getValidTransitions('IDLE');
      expect(transitions).toContain('GOAL_INGESTED');
    });

    it('should return correct transitions for EXECUTE_SESSION', () => {
      const transitions = machine.getValidTransitions('EXECUTE_SESSION');
      expect(transitions).toContain('TASK_ASSIGNED');
      expect(transitions).toContain('TASK_COMPLETED');
      expect(transitions).toContain('TASK_FAILED');
      expect(transitions).toContain('VERIFICATION_PASSED');
      expect(transitions).toContain('RESET');
    });

    it('should return empty array for unknown state', () => {
      const transitions = machine.getValidTransitions('UNKNOWN' as State);
      expect(transitions).toEqual([]);
    });
  });
});
