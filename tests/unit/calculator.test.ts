/**
 * Score Calculator Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { ScoreCalculator } from '../../src/subsystems/scoring-engine/calculator.js';
import type { OrchestratorState } from '../../src/types/state.js';

describe('ScoreCalculator', () => {
  const calculator = new ScoreCalculator({
    projectPath: '/tmp/test'
  });

  describe('calculateRequirementsCoverage', () => {
    it('should return 0 when no goal exists', () => {
      const state = {
        projectGoal: null,
        progress: { completedTasks: [] }
      } as OrchestratorState;

      const result = (calculator as any).calculateRequirementsCoverage(state);
      expect(result).toBe(0);
    });

    it('should calculate coverage based on verified requirements', () => {
      const state = {
        projectGoal: {
          requirements: [
            { id: 'r1', verified: true, weight: 1 },
            { id: 'r2', verified: false, weight: 1 },
            { id: 'r3', verified: true, weight: 2 }
          ]
        },
        progress: { completedTasks: [] }
      } as OrchestratorState;

      const result = (calculator as any).calculateRequirementsCoverage(state);
      // (1 + 0 + 2) / (1 + 1 + 2) = 3/4 = 0.75
      expect(result).toBe(0.75);
    });

    it('should return 1 when all requirements verified', () => {
      const state = {
        projectGoal: {
          requirements: [
            { id: 'r1', verified: true, weight: 1 },
            { id: 'r2', verified: true, weight: 1 }
          ]
        },
        progress: { completedTasks: [] }
      } as OrchestratorState;

      const result = (calculator as any).calculateRequirementsCoverage(state);
      expect(result).toBe(1);
    });
  });

  describe('calculatePenalties', () => {
    it('should calculate penalties for recurring errors', () => {
      const state = {
        projectGoal: null,
        taskQueue: { failed: [] },
        errorLog: {
          patterns: [
            { frequency: 3, pattern: 'SyntaxError' },
            { frequency: 5, pattern: 'TypeError' }
          ]
        }
      } as unknown as OrchestratorState;

      const result = (calculator as any).calculatePenalties(state);
      // Recurring errors (frequency >= 3) add penalty of 5
      expect(result).toBe(5);
    });

    it('should return 0 when no recurring errors', () => {
      const state = {
        projectGoal: null,
        taskQueue: { failed: [] },
        errorLog: {
          patterns: [
            { frequency: 1, pattern: 'Error' },
            { frequency: 2, pattern: 'Warning' }
          ]
        }
      } as unknown as OrchestratorState;

      const result = (calculator as any).calculatePenalties(state);
      expect(result).toBe(0);
    });
  });

  describe('calculateTrend', () => {
    it('should detect improving trend', () => {
      const entries = [
        { score: 50, timestamp: new Date('2024-01-01') },
        { score: 60, timestamp: new Date('2024-01-02') },
        { score: 70, timestamp: new Date('2024-01-03') }
      ];

      const result = (calculator as any).calculateTrend(entries as any);
      expect(result).toBe('improving');
    });

    it('should detect regressing trend', () => {
      const entries = [
        { score: 70, timestamp: new Date('2024-01-01') },
        { score: 60, timestamp: new Date('2024-01-02') },
        { score: 50, timestamp: new Date('2024-01-03') }
      ];

      const result = (calculator as any).calculateTrend(entries as any);
      expect(result).toBe('regressing');
    });

    it('should detect stable trend', () => {
      const entries = [
        { score: 60, timestamp: new Date('2024-01-01') },
        { score: 61, timestamp: new Date('2024-01-02') },
        { score: 60, timestamp: new Date('2024-01-03') }
      ];

      const result = (calculator as any).calculateTrend(entries as any);
      expect(result).toBe('stable');
    });

    it('should return stable for insufficient data', () => {
      const entries = [{ score: 60, timestamp: new Date() }];
      const result = (calculator as any).calculateTrend(entries as any);
      expect(result).toBe('stable');
    });
  });

  describe('calculateVelocity', () => {
    it('should calculate velocity from entries', () => {
      const entries = [
        { score: 50, timestamp: new Date('2024-01-01T00:00:00') },
        { score: 60, timestamp: new Date('2024-01-01T01:00:00') }
      ];

      const result = (calculator as any).calculateVelocity(entries as any);
      // 10 points per hour, normalized
      expect(result).toBeGreaterThan(0);
    });

    it('should return 0 for insufficient data', () => {
      const result = (calculator as any).calculateVelocity([]);
      expect(result).toBe(0);
    });
  });

  describe('calculateScore', () => {
    it('should return valid score structure', async () => {
      const state = {
        projectGoal: null,
        taskQueue: { pending: [], failed: [], phases: [] },
        errorLog: { patterns: [] },
        progress: { completedTasks: [] }
      } as unknown as OrchestratorState;

      const result = await calculator.calculateScore(state);
      expect(result.score).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.breakdown).toBeDefined();
    });
  });
});
