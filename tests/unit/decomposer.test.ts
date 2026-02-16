/**
 * Task Decomposer Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { TaskDecomposer } from '../../src/subsystems/roadmap-generator/decomposer.js';
import type { Gap } from '../../src/types/gap.js';

describe('TaskDecomposer', () => {
  const decomposer = new TaskDecomposer();

  describe('generateRoadmap', () => {
    it('should handle empty gaps array', () => {
      const result = decomposer.generateRoadmap([]);
      expect(result.phases).toEqual([]);
      expect(result.tasks).toEqual([]);
    });

    it('should process gaps and create tasks', () => {
      const gaps: Gap[] = [
        {
          id: 'gap-1',
          description: 'Missing test',
          type: 'TEST_FAILURE',
          severity: 'medium',
          affectedFiles: ['src/a.test.ts'],
          suggestedTasks: [
            { title: 'Add test', description: 'Test it', verification: ['npm test'] }
          ],
          missingParts: []
        },
        {
          id: 'gap-2',
          description: 'Missing feature',
          type: 'MISSING_IMPLEMENTATION',
          severity: 'high',
          affectedFiles: ['src/feature.ts'],
          suggestedTasks: [
            { title: 'Implement feature', description: 'Feature', verification: ['npm test'] }
          ],
          missingParts: ['feature function']
        }
      ];

      const result = decomposer.generateRoadmap(gaps);
      // Should process both gaps and create tasks
      expect(Array.isArray(result.phases)).toBe(true);
      expect(Array.isArray(result.tasks)).toBe(true);
      // Should have created tasks from gaps
      expect(result.tasks.length).toBeGreaterThan(0);
    });

    it('should create tasks with valid structure', () => {
      const gaps: Gap[] = [
        {
          id: 'gap-1',
          description: 'Test gap',
          type: 'MISSING_IMPLEMENTATION',
          severity: 'high',
          affectedFiles: ['src/test.ts'],
          suggestedTasks: [
            { title: 'Do something', description: 'Do it', verification: ['test'] }
          ],
          missingParts: []
        }
      ];

      const result = decomposer.generateRoadmap(gaps);
      expect(result.tasks.length).toBeGreaterThan(0);
      
      const task = result.tasks[0];
      expect(task.id).toBeDefined();
      expect(task.title).toBeDefined();
      expect(task.description).toBeDefined();
      expect(task.phase).toBeGreaterThan(0);
      expect(task.status).toBe('pending');
      expect(task.attempts).toBe(0);
    });
  });

  describe('artifact extraction', () => {
    it('should extract file names from text', () => {
      const text = 'Create src/auth.ts and src/utils/helpers.js';
      const result = (decomposer as any).extractArtifactNames(text);
      expect(result).toContain('src/auth.ts');
      expect(result).toContain('src/utils/helpers.js');
    });

    it('should extract component names from text', () => {
      const text = 'Implement LoginComponent and AuthService';
      const result = (decomposer as any).extractArtifactNames(text);
      expect(result).toContain('LoginComponent');
      expect(result).toContain('AuthService');
    });
  });
});
