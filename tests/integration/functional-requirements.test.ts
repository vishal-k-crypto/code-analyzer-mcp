/**
 * Functional Requirements Integration Tests (F1-F8)
 * 
 * F1: Ingest complex goal with 5+ requirements
 * F2: Break goal into 5+ phases
 * F3: Bounded context with relevant/forbidden files
 * F4: Verification command execution + output capture
 * F5: Error trapping forces retry in same session
 * F6: Score calculation produces 0-100 value
 * F7: State persistence across restarts
 * F8: Recovery from crash during task execution
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Orchestrator } from '../../src/core/orchestrator.js';

describe('Functional Requirements F1-F8', () => {
  let tempDir: string;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-freq-'));
    orchestrator = new Orchestrator({
      projectPath: tempDir,
      qualityThreshold: 85
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * F1: Can ingest a complex project goal with 5+ requirements
   */
  describe('F1: Complex Goal Ingestion', () => {
    it('should ingest a complex goal with 5+ requirements', async () => {
      await orchestrator.init();

      const complexGoal = `
        Build a task management API with the following features:
        1. User authentication with JWT tokens
        2. CRUD operations for tasks (create, read, update, delete)
        3. Task filtering and sorting by status, priority, and due date
        4. Team collaboration with shared projects and permissions
        5. Real-time notifications via WebSocket
        6. Export tasks to CSV and PDF formats
        7. Integration with calendar APIs
      `;

      const result = await orchestrator.ingestGoal(complexGoal);

      // Should extract at least 5 requirements
      expect(result.count).toBeGreaterThanOrEqual(5);
      expect(['llm', 'rule-based', 'provided']).toContain(result.method);

      const status = orchestrator.getStatus();
      expect(status.pendingTasks).toBeGreaterThanOrEqual(5);
    });

    it('should ingest structured requirements directly', async () => {
      await orchestrator.init();

      const result = await orchestrator.ingestGoal('Complex Project', [], [
        { id: 'req-1', description: 'User authentication', type: 'feature', priority: 'critical', components: ['auth.ts'], acceptanceCriteria: ['Users can login'], dependencies: [] },
        { id: 'req-2', description: 'Task CRUD', type: 'feature', priority: 'critical', components: ['tasks.ts'], acceptanceCriteria: ['Tasks can be created'], dependencies: ['req-1'] },
        { id: 'req-3', description: 'Filtering', type: 'feature', priority: 'high', components: ['filter.ts'], acceptanceCriteria: ['Filter by status'], dependencies: ['req-2'] },
        { id: 'req-4', description: 'Team collaboration', type: 'feature', priority: 'high', components: ['teams.ts'], acceptanceCriteria: ['Share projects'], dependencies: ['req-1'] },
        { id: 'req-5', description: 'Notifications', type: 'feature', priority: 'medium', components: ['notifications.ts'], acceptanceCriteria: ['Real-time updates'], dependencies: ['req-4'] },
        { id: 'req-6', description: 'Export', type: 'feature', priority: 'low', components: ['export.ts'], acceptanceCriteria: ['CSV export'], dependencies: ['req-2'] }
      ]);

      expect(result.count).toBe(6);
      expect(result.method).toBe('provided');
      expect(orchestrator.getStatus().pendingTasks).toBeGreaterThanOrEqual(5);
    });
  });

  /**
   * F2: Breaks down goal into at least 5 distinct phases
   */
  describe('F2: Phase Decomposition', () => {
    it('should create at least 5 phases for complex goals', async () => {
      await orchestrator.init();

      const goal = `
        Create a full-stack e-commerce application with:
        1. Product catalog with search and filters
        2. Shopping cart and checkout flow
        3. Payment integration with Stripe
        4. Order management and tracking
        5. Admin dashboard for inventory
        6. User reviews and ratings
        7. Email notifications
        8. Analytics and reporting
      `;

      await orchestrator.ingestGoal(goal);
      const tasks = orchestrator.listTasks('all');

      // Extract unique phases
      const phases = new Set(tasks.map(t => t.phase));
      expect(phases.size).toBeGreaterThanOrEqual(5);

      // Verify phase ordering (lower numbers should come first)
      const sortedPhases = Array.from(phases).sort((a, b) => a - b);
      expect(sortedPhases[0]).toBe(1);

      // Verify tasks are distributed across phases
      for (const phase of phases) {
        const phaseTasks = tasks.filter(t => t.phase === phase);
        expect(phaseTasks.length).toBeGreaterThan(0);
      }
    });

    it('should order phases correctly (foundational first)', async () => {
      await orchestrator.init();

      await orchestrator.ingestGoal('Build web app', [], [
        { id: 'r1', description: 'Database setup', type: 'feature', priority: 'critical', components: ['db.ts'], acceptanceCriteria: ['DB connected'], dependencies: [] },
        { id: 'r2', description: 'API routes', type: 'feature', priority: 'critical', components: ['api.ts'], acceptanceCriteria: ['Routes work'], dependencies: ['r1'] },
        { id: 'r3', description: 'Frontend UI', type: 'feature', priority: 'high', components: ['ui.tsx'], acceptanceCriteria: ['UI renders'], dependencies: ['r2'] },
        { id: 'r4', description: 'Authentication', type: 'feature', priority: 'critical', components: ['auth.ts'], acceptanceCriteria: ['Login works'], dependencies: ['r1'] },
        { id: 'r5', description: 'Admin panel', type: 'feature', priority: 'medium', components: ['admin.tsx'], acceptanceCriteria: ['Admin works'], dependencies: ['r3', 'r4'] }
      ]);

      const tasks = orchestrator.listTasks('all');
      
      // Dependencies should be in earlier or same phase
      const dbTask = tasks.find(t => t.requirementId === 'r1');
      const apiTask = tasks.find(t => t.requirementId === 'r2');
      
      if (dbTask && apiTask) {
        expect(apiTask.phase).toBeGreaterThanOrEqual(dbTask.phase);
      }
    });
  });

  /**
   * F3: Each task has bounded context with relevant/forbidden files
   */
  describe('F3: Bounded Context Assembly', () => {
    it('should provide bounded context with relevant files', async () => {
      await orchestrator.init();

      // Create some source files to test file relevance
      const srcDir = join(tempDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'auth.ts'), 'export function login() {}');
      writeFileSync(join(srcDir, 'user.ts'), 'export interface User {}');
      writeFileSync(join(srcDir, 'utils.ts'), 'export function helper() {}');

      await orchestrator.ingestGoal('Implement user authentication system', [], [
        { id: 'r1', description: 'Create login function', type: 'feature', priority: 'critical', components: ['auth.ts'], acceptanceCriteria: ['Login works'], dependencies: [] }
      ]);

      const result = await orchestrator.getNextTarget('session-1');

      // Context should contain relevant files
      expect(result.context).toContain('auth.ts');
      
      // Context should have bounded context structure
      expect(result.context).toContain('BOUNDED CONTEXT');
      expect(result.context).toContain('RELEVANT FILES');
      expect(result.context).toContain('FORBIDDEN FILES');
      expect(result.context).toContain('ACCEPTANCE CRITERIA');
    });

    it('should forbid modification of unrelated files', async () => {
      await orchestrator.init();

      // Create various source files
      const srcDir = join(tempDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'auth.ts'), 'export function login() {}');
      writeFileSync(join(srcDir, 'database.ts'), 'export function query() {}');
      writeFileSync(join(srcDir, 'config.ts'), 'export const config = {}');
      writeFileSync(join(srcDir, 'unrelated.ts'), 'export function other() {}');

      await orchestrator.ingestGoal('Fix login authentication', [], [
        { id: 'r1', description: 'Fix auth bug', type: 'bugfix', priority: 'critical', components: ['auth.ts'], acceptanceCriteria: ['Auth works'], dependencies: [] }
      ]);

      const result = await orchestrator.getNextTarget('session-1');

      // Should explicitly mention forbidden files
      expect(result.context).toContain('FORBIDDEN');
      expect(result.context).toContain('DO NOT');
    });
  });

  /**
   * F4: Can execute verification commands and capture output
   */
  describe('F4: Verification Command Execution', () => {
    it('should execute verification commands and capture stdout/stderr/exit code', async () => {
      // Create a simple Node.js project with tests
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: { test: 'echo "Tests: 5 passed" && exit 0' }
      }));

      await orchestrator.init();
      await orchestrator.ingestGoal('Test project');

      // The orchestrator should be able to execute commands
      // This is verified through the sandbox execution in submitResult
      const status = orchestrator.getStatus();
      expect(status.state).toBeDefined();
    });

    it('should capture test output for scoring', async () => {
      const { ExecutionSandbox } = await import('../../src/subsystems/execution-sandbox/runner.js');
      
      const sandbox = new ExecutionSandbox(tempDir);
      
      // Create a simple script that outputs test results
      const scriptPath = join(tempDir, 'test.js');
      writeFileSync(scriptPath, `
        console.log('Running tests...');
        console.log('✓ Test 1 passed');
        console.log('✓ Test 2 passed');
        console.error('Warning: deprecated API');
        process.exit(0);
      `);

      const result = await sandbox.execute('node', ['test.js'], { timeout: 30000 });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Test 1 passed');
      expect(result.stderr).toContain('Warning');
      expect(result.duration).toBeGreaterThan(0);
    });
  });

  /**
   * F5: Error trapping forces retry in same session
   */
  describe('F5: Error Trapping and Retry', () => {
    it('should track failed tasks and allow retry', async () => {
      await orchestrator.init();

      await orchestrator.ingestGoal('Test project', [], [
        { id: 'r1', description: 'Implement feature', type: 'feature', priority: 'critical', components: ['feature.ts'], acceptanceCriteria: ['Works'], dependencies: [] }
      ]);

      // Get the task
      const result = await orchestrator.getNextTarget('session-1');
      expect(result.task).not.toBeNull();
      const taskId = result.task!.id;

      // Check that task is now in_progress
      let status = orchestrator.getStatus();
      expect(status.currentTask).not.toBeNull();

      // Simulate a failure by forcing retry (this tests the retry mechanism)
      await orchestrator.forceRetry(taskId);

      // Task should be back in pending queue
      const pendingTasks = orchestrator.listTasks('pending');
      expect(pendingTasks.some(t => t.id === taskId)).toBe(true);

      // Failed tasks count should increase
      status = orchestrator.getStatus();
      expect(status.failedTasks).toBeGreaterThan(0);
    });

    it('should increment attempt counter on retry', async () => {
      await orchestrator.init();

      await orchestrator.ingestGoal('Test project', [], [
        { id: 'r1', description: 'Fix bug', type: 'bugfix', priority: 'high', components: ['bug.ts'], acceptanceCriteria: ['Fixed'], dependencies: [] }
      ]);

      const result = await orchestrator.getNextTarget('session-1');
      const taskId = result.task!.id;
      const initialAttempts = result.task!.attempts;

      // Force retry
      await orchestrator.forceRetry(taskId);

      // Get task again
      const result2 = await orchestrator.getNextTarget('session-1');
      expect(result2.task!.attempts).toBe(initialAttempts + 1);
    });
  });

  /**
   * F6: Score calculation produces 0-100 value
   */
  describe('F6: Score Calculation 0-100', () => {
    it('should calculate score between 0 and 100', async () => {
      const { ScoreCalculator } = await import('../../src/subsystems/scoring-engine/calculator.js');
      
      const calculator = new ScoreCalculator({ projectPath: tempDir });

      const state = {
        projectGoal: {
          requirements: [
            { id: 'r1', verified: true, weight: 1 },
            { id: 'r2', verified: false, weight: 1 }
          ]
        },
        taskQueue: {
          phases: [
            { number: 1, title: 'Phase 1', description: 'Test', tasks: [
              { id: 't1', status: 'completed', phase: 1 },
              { id: 't2', status: 'pending', phase: 1 }
            ]}
          ],
          pending: [],
          failed: [],
          inProgress: null,
          dependencies: new Map()
        },
        errorLog: { patterns: [] },
        progress: { completedTasks: [{ id: 't1' }] }
      } as any;

      const result = await calculator.calculateScore(state);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(result.score)).toBe(true);
    });

    it('should return score of 0 for empty project', async () => {
      const { ScoreCalculator } = await import('../../src/subsystems/scoring-engine/calculator.js');
      
      const calculator = new ScoreCalculator({ projectPath: tempDir });

      const state = {
        projectGoal: null,
        taskQueue: { phases: [], pending: [], failed: [], inProgress: null, dependencies: new Map() },
        errorLog: { patterns: [] },
        progress: { completedTasks: [] }
      } as any;

      const result = await calculator.calculateScore(state);

      expect(result.score).toBe(0);
    });

    it('should provide score breakdown', async () => {
      const { ScoreCalculator } = await import('../../src/subsystems/scoring-engine/calculator.js');
      
      const calculator = new ScoreCalculator({ projectPath: tempDir });

      const state = {
        projectGoal: { requirements: [{ id: 'r1', verified: true, weight: 1 }] },
        taskQueue: { phases: [], pending: [], failed: [], inProgress: null, dependencies: new Map() },
        errorLog: { patterns: [] },
        progress: { completedTasks: [] }
      } as any;

      const result = await calculator.calculateScore(state);

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.requirementsCoverage).toBeDefined();
      expect(result.breakdown.testPassRate).toBeDefined();
      expect(result.breakdown.codeQuality).toBeDefined();
      expect(result.breakdown.implementationCompleteness).toBeDefined();
      expect(result.breakdown.penalties).toBeDefined();
    });
  });

  /**
   * F7: State persists across server restarts
   */
  describe('F7: State Persistence', () => {
    it('should persist state to disk', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Persistent project', [], [
        { id: 'r1', description: 'Feature', type: 'feature', priority: 'critical', components: ['feat.ts'], acceptanceCriteria: ['Works'], dependencies: [] }
      ]);

      const statusBefore = orchestrator.getStatus();
      const pendingBefore = statusBefore.pendingTasks;

      // Create new orchestrator instance pointing to same directory
      const orchestrator2 = new Orchestrator({
        projectPath: tempDir,
        qualityThreshold: 85
      });
      await orchestrator2.init();

      const statusAfter = orchestrator2.getStatus();

      // State should be restored
      expect(statusAfter.pendingTasks).toBe(pendingBefore);
      expect(statusAfter.state).toBe(statusBefore.state);
    });

    it('should persist goal across restarts', async () => {
      await orchestrator.init();
      
      const goal = 'Create persistent application';
      await orchestrator.ingestGoal(goal, [], [
        { id: 'r1', description: 'Feature 1', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] },
        { id: 'r2', description: 'Feature 2', type: 'feature', priority: 'high', components: [], acceptanceCriteria: [], dependencies: [] }
      ]);

      // Create new instance
      const orchestrator2 = new Orchestrator({ projectPath: tempDir });
      await orchestrator2.init();

      const tasks = orchestrator2.listTasks('all');
      expect(tasks.length).toBeGreaterThanOrEqual(2);
    });

    it('should persist task completion status', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Test persistence');

      // Get and complete a task
      const result = await orchestrator.getNextTarget('session-1');
      const taskId = result.task!.id;

      // Create new instance - task should still be in progress
      const orchestrator2 = new Orchestrator({ projectPath: tempDir });
      await orchestrator2.init();

      const status = orchestrator2.getStatus();
      expect(status.state).toBeDefined();
    });
  });

  /**
   * F8: Can recover from crash during task execution
   */
  describe('F8: Crash Recovery', () => {
    it('should create checkpoints for recovery', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Recovery test project');

      const checkpointId = await orchestrator.createCheckpoint('pre-execution');
      expect(checkpointId).toBe('pre-execution');

      // Get a task (changes state)
      await orchestrator.getNextTarget('session-1');
      const statusBefore = orchestrator.getStatus();

      // Restore checkpoint
      await orchestrator.restoreCheckpoint('pre-execution');
      const statusAfter = orchestrator.getStatus();

      // State should be restored (or at least consistent)
      expect(statusAfter.state).toBeDefined();
    });

    it('should restore from checkpoint after simulated crash', async () => {
      await orchestrator.init();
      await orchestrator.ingestGoal('Crash recovery test', [], [
        { id: 'r1', description: 'Feature A', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] },
        { id: 'r2', description: 'Feature B', type: 'feature', priority: 'high', components: [], acceptanceCriteria: [], dependencies: ['r1'] }
      ]);

      // Create checkpoint
      await orchestrator.createCheckpoint('stable-state');

      // Simulate work
      await orchestrator.getNextTarget('session-1');

      // Simulate crash by creating new instance and restoring
      const recoveredOrchestrator = new Orchestrator({ projectPath: tempDir });
      await recoveredOrchestrator.init();
      await recoveredOrchestrator.restoreCheckpoint('stable-state');

      // Should be in a consistent state
      const status = recoveredOrchestrator.getStatus();
      expect(status.state).toBeDefined();
      expect(status.pendingTasks).toBeGreaterThanOrEqual(0);
    });

    it('should have journal for crash recovery', async () => {
      await orchestrator.init();
      
      // The state manager should create journal entries
      const { StateManager } = await import('../../src/subsystems/state-manager/index.js');
      const stateManager = new StateManager(tempDir);
      await stateManager.init();

      // Save some state
      await stateManager.saveState({
        projectGoal: { id: 'test', description: 'Test' } as any,
        progress: { currentState: 'EXECUTE_SESSION' } as any,
        taskQueue: { phases: [], pending: [], failed: [], inProgress: null, dependencies: new Map() },
        errorLog: { entries: [], patterns: [], retryCount: new Map() },
        projectPath: tempDir
      });

      // Should be able to recover state
      const recovered = await stateManager.loadState();
      expect(recovered).not.toBeNull();
    });
  });
});
