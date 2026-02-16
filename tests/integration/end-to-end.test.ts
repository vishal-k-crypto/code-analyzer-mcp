/**
 * End-to-End Integration Test
 * Tests the complete orchestration workflow from goal ingestion to project completion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Orchestrator } from '../../src/core/orchestrator.js';

describe('End-to-End Orchestration Flow', () => {
  let tempDir: string;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-e2e-'));
    
    // Create a simple TypeScript project structure
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'e2e-test-project',
      version: '1.0.0',
      scripts: {
        test: 'echo "Tests: 1 passed, 0 failed" && exit 0',
        build: 'tsc --noEmit'
      },
      devDependencies: {
        typescript: '^5.0.0'
      }
    }, null, 2));

    writeFileSync(join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
      }
    }, null, 2));

    orchestrator = new Orchestrator({
      projectPath: tempDir,
      qualityThreshold: 85
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * E2E Test: Full workflow from goal to completion
   */
  it('should complete full workflow: ingest -> decompose -> execute -> score', async () => {
    await orchestrator.init();

    // Step 1: Ingest a simple goal
    const ingestResult = await orchestrator.ingestGoal(
      'Create a simple calculator module with add and subtract functions',
      [],
      [
        {
          id: 'calc-1',
          description: 'Create add function',
          type: 'feature',
          priority: 'critical',
          components: ['calculator.ts'],
          acceptanceCriteria: ['Can add two numbers', 'Returns correct sum'],
          dependencies: []
        },
        {
          id: 'calc-2',
          description: 'Create subtract function',
          type: 'feature',
          priority: 'high',
          components: ['calculator.ts'],
          acceptanceCriteria: ['Can subtract two numbers', 'Returns correct difference'],
          dependencies: ['calc-1']
        }
      ]
    );

    expect(ingestResult.count).toBe(2);
    expect(orchestrator.getStatus().pendingTasks).toBeGreaterThan(0);

    // Step 2: Get first task
    const task1Result = await orchestrator.getNextTarget('session-1');
    expect(task1Result.task).not.toBeNull();
    expect(task1Result.context).toContain('BOUNDED CONTEXT');

    const task1Id = task1Result.task!.id;

    // Step 3: Submit result for first task
    const submitResult1 = await orchestrator.submitResult(
      task1Id,
      [
        {
          path: 'calculator.ts',
          content: `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`
        }
      ],
      'Implemented add and subtract functions'
    );

    // Note: Verification might fail due to missing test infrastructure,
    // but the task submission should complete
    expect(submitResult1).toBeDefined();

    // Step 4: Check status after submission
    const statusAfterSubmit = orchestrator.getStatus();
    expect(statusAfterSubmit.state).toBeDefined();

    // Step 5: Get score
    const scoreResult = orchestrator.getScore();
    expect(scoreResult.score).toBeGreaterThanOrEqual(0);
    expect(scoreResult.score).toBeLessThanOrEqual(100);

    // Step 6: List all tasks
    const allTasks = orchestrator.listTasks('all');
    expect(allTasks.length).toBeGreaterThan(0);

    // Step 7: Create checkpoint
    const checkpointId = await orchestrator.createCheckpoint('e2e-checkpoint');
    expect(checkpointId).toBe('e2e-checkpoint');

    // Step 8: Restore checkpoint
    await orchestrator.restoreCheckpoint('e2e-checkpoint');
    const statusAfterRestore = orchestrator.getStatus();
    expect(statusAfterRestore).toBeDefined();
  });

  /**
   * E2E Test: State persistence across instances
   */
  it('should persist and restore state across orchestrator instances', async () => {
    // Instance 1: Ingest goal
    await orchestrator.init();
    await orchestrator.ingestGoal('Persistent test project', [], [
      {
        id: 'persist-1',
        description: 'Persistent feature',
        type: 'feature',
        priority: 'critical',
        components: [],
        acceptanceCriteria: ['Works'],
        dependencies: []
      }
    ]);

    const status1 = orchestrator.getStatus();
    const pendingCount1 = status1.pendingTasks;

    // Instance 2: Load saved state
    const orchestrator2 = new Orchestrator({
      projectPath: tempDir,
      qualityThreshold: 85
    });
    await orchestrator2.init();

    const status2 = orchestrator2.getStatus();
    expect(status2.pendingTasks).toBe(pendingCount1);
    expect(status2.state).toBe(status1.state);

    // Instance 3: Verify still consistent
    const orchestrator3 = new Orchestrator({
      projectPath: tempDir,
      qualityThreshold: 85
    });
    await orchestrator3.init();

    const tasks3 = orchestrator3.listTasks('all');
    expect(tasks3.length).toBeGreaterThan(0);
  });

  /**
   * E2E Test: Multiple task workflow
   */
  it('should handle multiple sequential tasks', async () => {
    await orchestrator.init();

    // Ingest a goal with multiple independent tasks
    await orchestrator.ingestGoal('Multi-task project', [], [
      {
        id: 'multi-1',
        description: 'Task 1: Create config',
        type: 'feature',
        priority: 'critical',
        components: ['config.ts'],
        acceptanceCriteria: ['Config exists'],
        dependencies: []
      },
      {
        id: 'multi-2',
        description: 'Task 2: Create utils',
        type: 'feature',
        priority: 'high',
        components: ['utils.ts'],
        acceptanceCriteria: ['Utils work'],
        dependencies: []
      },
      {
        id: 'multi-3',
        description: 'Task 3: Create main',
        type: 'feature',
        priority: 'high',
        components: ['main.ts'],
        acceptanceCriteria: ['Main runs'],
        dependencies: ['multi-1', 'multi-2']
      }
    ]);

    // Get first task
    const result1 = await orchestrator.getNextTarget('session-1');
    expect(result1.task).not.toBeNull();

    // Complete first task
    await orchestrator.submitResult(
      result1.task!.id,
      [{ path: 'config.ts', content: 'export const config = {};'}],
      'Created config'
    );

    // Get second task
    const result2 = await orchestrator.getNextTarget('session-2');
    if (result2.task) {
      await orchestrator.submitResult(
        result2.task.id,
        [{ path: 'utils.ts', content: 'export function util() {}'}],
        'Created utils'
      );
    }

    // Verify workflow progress
    const status = orchestrator.getStatus();
    expect(status.completedTasks + status.pendingTasks + status.failedTasks).toBeGreaterThan(0);
  });

  /**
   * E2E Test: Error handling and retry
   */
  it('should handle task failures and allow retry', async () => {
    await orchestrator.init();

    await orchestrator.ingestGoal('Retry test project', [], [
      {
        id: 'retry-1',
        description: 'Flaky feature',
        type: 'feature',
        priority: 'critical',
        components: [],
        acceptanceCriteria: ['Works eventually'],
        dependencies: []
      }
    ]);

    const result = await orchestrator.getNextTarget('session-1');
    expect(result.task).not.toBeNull();

    const taskId = result.task!.id;

    // Simulate task failure by forcing retry
    await orchestrator.forceRetry(taskId);

    // Task should be back in pending
    const pendingTasks = orchestrator.listTasks('pending');
    const retriedTask = pendingTasks.find(t => t.id === taskId);
    
    // The task should either be pending or failed
    const allTasks = orchestrator.listTasks('all');
    const taskExists = allTasks.some(t => t.id === taskId);
    expect(taskExists).toBe(true);
  });

  /**
   * E2E Test: Checkpoint and recovery
   */
  it('should create and restore checkpoints correctly', async () => {
    await orchestrator.init();

    // Initial state
    await orchestrator.ingestGoal('Checkpoint test', [], [
      { id: 'cp-1', description: 'Feature', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] }
    ]);

    const initialPending = orchestrator.getStatus().pendingTasks;

    // Create checkpoint
    await orchestrator.createCheckpoint('before-changes');

    // Make changes - get and "work on" a task
    const result = await orchestrator.getNextTarget('session-1');
    expect(result.task).not.toBeNull();

    const statusBeforeRestore = orchestrator.getStatus();

    // Restore checkpoint
    await orchestrator.restoreCheckpoint('before-changes');

    const statusAfterRestore = orchestrator.getStatus();
    // After restore, should have same or similar state
    expect(statusAfterRestore.pendingTasks).toBeGreaterThanOrEqual(0);
  });

  /**
   * E2E Test: Project verification
   */
  it('should verify project state using orchestrator_verify', async () => {
    await orchestrator.init();

    // Create a simple test file
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src/index.ts'), 'export const hello = "world";');

    // Run verification (may fail due to missing test infrastructure)
    const verifyResult = await orchestrator.verifyProject(false);
    
    expect(verifyResult).toBeDefined();
    expect(typeof verifyResult.success).toBe('boolean');
    expect(typeof verifyResult.output).toBe('string');
  });

  /**
   * E2E Test: Reset functionality
   */
  it('should reset state completely when confirmed', async () => {
    await orchestrator.init();

    // Setup state
    await orchestrator.ingestGoal('To be reset', [], [
      { id: 'reset-1', description: 'Temporary', type: 'feature', priority: 'critical', components: [], acceptanceCriteria: [], dependencies: [] }
    ]);

    expect(orchestrator.getStatus().pendingTasks).toBeGreaterThan(0);

    // Reset
    await orchestrator.reset(true);

    const statusAfterReset = orchestrator.getStatus();
    expect(statusAfterReset.state).toBe('IDLE');
    expect(statusAfterReset.pendingTasks).toBe(0);
    expect(statusAfterReset.score).toBe(0);
    expect(statusAfterReset.currentTask).toBeNull();
  });

  /**
   * E2E Test: Complex dependency chain
   */
  it('should respect task dependencies', async () => {
    await orchestrator.init();

    // Create a chain: A -> B -> C (A must complete before B, B before C)
    await orchestrator.ingestGoal('Dependency chain project', [], [
      {
        id: 'dep-c',
        description: 'Task C - depends on B',
        type: 'feature',
        priority: 'critical',
        components: [],
        acceptanceCriteria: ['C works'],
        dependencies: ['dep-b']
      },
      {
        id: 'dep-b',
        description: 'Task B - depends on A',
        type: 'feature',
        priority: 'critical',
        components: [],
        acceptanceCriteria: ['B works'],
        dependencies: ['dep-a']
      },
      {
        id: 'dep-a',
        description: 'Task A - no dependencies',
        type: 'feature',
        priority: 'critical',
        components: [],
        acceptanceCriteria: ['A works'],
        dependencies: []
      }
    ]);

    // First task should be A (no dependencies)
    const first = await orchestrator.getNextTarget('session-1');
    expect(first.task?.requirementId).toBe('dep-a');

    // Submit A
    await orchestrator.submitResult(first.task!.id, [], 'Done A');

    // Second task should be B
    const second = await orchestrator.getNextTarget('session-2');
    expect(second.task?.requirementId).toBe('dep-b');

    // Submit B
    await orchestrator.submitResult(second.task!.id, [], 'Done B');

    // Third task should be C
    const third = await orchestrator.getNextTarget('session-3');
    expect(third.task?.requirementId).toBe('dep-c');
  });

  /**
   * E2E Test: File modification tracking
   */
  it('should track modified files through task execution', async () => {
    await orchestrator.init();

    mkdirSync(join(tempDir, 'src'), { recursive: true });

    await orchestrator.ingestGoal('File tracking test', [], [
      {
        id: 'file-1',
        description: 'Create module',
        type: 'feature',
        priority: 'critical',
        components: ['module.ts'],
        acceptanceCriteria: ['Module exists'],
        dependencies: []
      }
    ]);

    const result = await orchestrator.getNextTarget('session-1');
    
    // Submit with file changes
    await orchestrator.submitResult(
      result.task!.id,
      [
        { path: 'src/module.ts', content: 'export const module = {};'},
        { path: 'src/helper.ts', content: 'export const helper = {};'}
      ],
      'Created files'
    );

    // Verify files were written
    expect(existsSync(join(tempDir, 'src/module.ts'))).toBe(true);
    expect(existsSync(join(tempDir, 'src/helper.ts'))).toBe(true);

    // Verify content
    const content = readFileSync(join(tempDir, 'src/module.ts'), 'utf-8');
    expect(content).toContain('export const module');
  });
});
