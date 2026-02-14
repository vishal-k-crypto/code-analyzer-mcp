/**
 * Context Templates
 * Templates for generating bounded context prompts
 */

import type { Task, BoundedContext, ProjectGoal } from '../../types/state.js';

export interface ContextTemplateData {
  projectGoal: ProjectGoal | null;
  task: Task;
  boundedContext: BoundedContext;
  phase: {
    current: number;
    total: number;
    title: string;
  };
  completedCount: number;
  totalCount: number;
}

export function generateBoundedContextPrompt(data: ContextTemplateData): string {
  const { projectGoal, task, boundedContext, phase, completedCount, totalCount } = data;

  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════════════════════╗');
  lines.push('║                    BOUNDED CONTEXT SESSION                                   ║');
  lines.push('╚══════════════════════════════════════════════════════════════════════════════╝');
  lines.push('');

  // Master Goal
  if (projectGoal) {
    lines.push('📋 MASTER GOAL');
    lines.push('─'.repeat(80));
    lines.push(projectGoal.description);
    lines.push('');
  }

  // Progress
  lines.push(`📊 PROGRESS: Phase ${phase.current} of ${phase.total} | ${completedCount}/${totalCount} tasks completed`);
  lines.push('─'.repeat(80));
  lines.push('');

  // Phase Info
  lines.push(`🎯 CURRENT PHASE: ${phase.title}`);
  lines.push('');

  // Single Target
  lines.push('⚡ YOUR SINGLE TARGET');
  lines.push('─'.repeat(80));
  lines.push(`Title: ${task.title}`);
  lines.push('');
  lines.push('Description:');
  lines.push(task.description);
  lines.push('');

  // Relevant Files
  lines.push('📁 RELEVANT FILES ONLY');
  lines.push('─'.repeat(80));
  lines.push('You may ONLY modify these files:');
  for (const file of boundedContext.relevantFiles) {
    lines.push(`  ✓ ${file}`);
  }
  lines.push('');

  // Forbidden Files
  if (boundedContext.forbiddenFiles.length > 0) {
    lines.push('🚫 FORBIDDEN FILES');
    lines.push('─'.repeat(80));
    lines.push('DO NOT touch these files:');
    const displayForbidden = boundedContext.forbiddenFiles.slice(0, 10);
    for (const file of displayForbidden) {
      lines.push(`  ✗ ${file}`);
    }
    if (boundedContext.forbiddenFiles.length > 10) {
      lines.push(`  ... and ${boundedContext.forbiddenFiles.length - 10} more`);
    }
    lines.push('');
  }

  // Acceptance Criteria
  lines.push('✅ ACCEPTANCE CRITERIA');
  lines.push('─'.repeat(80));
  for (const criterion of task.acceptanceCriteria) {
    lines.push(`  ☐ ${criterion}`);
  }
  lines.push('');

  // Context Boundary
  lines.push('⚠️  CONTEXT BOUNDARY');
  lines.push('─'.repeat(80));
  lines.push('STRICT RULES:');
  lines.push('  • Do NOT refactor unrelated code');
  lines.push('  • Do NOT add features beyond this task');
  lines.push('  • Do NOT change file names or structures');
  lines.push('  • Do NOT modify forbidden files');
  lines.push('  • Focus ONLY on the specified target');
  lines.push('');

  // Verification
  lines.push('🔍 VERIFICATION');
  lines.push('─'.repeat(80));
  lines.push('After completion, run:');
  for (const cmd of task.verificationCommands) {
    lines.push(`  $ ${cmd}`);
  }
  lines.push('');

  // Expected Output
  if (boundedContext.expectedOutput) {
    lines.push('📝 EXPECTED OUTPUT');
    lines.push('─'.repeat(80));
    lines.push(boundedContext.expectedOutput);
    lines.push('');
  }

  lines.push('╔══════════════════════════════════════════════════════════════════════════════╗');
  lines.push('║  Complete this task, then use orchestrator_submit_result to report results   ║');
  lines.push('╚══════════════════════════════════════════════════════════════════════════════╝');

  return lines.join('\n');
}

export function generateErrorFixPrompt(
  task: Task,
  error: string,
  previousAttempts: number
): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════════════════════╗');
  lines.push('║                     ERROR FIX SESSION                                        ║');
  lines.push('╚══════════════════════════════════════════════════════════════════════════════╝');
  lines.push('');

  lines.push('⚠️  TASK FAILED - FIX REQUIRED');
  lines.push(`Attempt: ${previousAttempts + 1}`);
  lines.push('');

  lines.push('🎯 ORIGINAL TASK');
  lines.push('─'.repeat(80));
  lines.push(task.title);
  lines.push(task.description);
  lines.push('');

  lines.push('❌ ERROR');
  lines.push('─'.repeat(80));
  lines.push(error);
  lines.push('');

  lines.push('🔧 REQUIRED ACTIONS');
  lines.push('─'.repeat(80));
  lines.push('1. Analyze the error message carefully');
  lines.push('2. Identify the root cause');
  lines.push('3. Fix ONLY the issue causing the error');
  lines.push('4. Do not introduce new changes');
  lines.push('5. Verify the fix resolves the error');
  lines.push('');

  lines.push('📁 FILES TO MODIFY');
  lines.push('─'.repeat(80));
  for (const file of task.context.relevantFiles) {
    lines.push(`  • ${file}`);
  }
  lines.push('');

  lines.push('╔══════════════════════════════════════════════════════════════════════════════╗');
  lines.push('║  Fix the error, then submit the corrected result                             ║');
  lines.push('╚══════════════════════════════════════════════════════════════════════════════╝');

  return lines.join('\n');
}

export function generateNextTargetGuide(
  currentState: string,
  hasActiveGoal: boolean,
  pendingTasks: number
): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════════════════════╗');
  lines.push('║                     ORCHESTRATOR GUIDE                                       ║');
  lines.push('╚══════════════════════════════════════════════════════════════════════════════╝');
  lines.push('');

  if (!hasActiveGoal) {
    lines.push('🚀 GETTING STARTED');
    lines.push('─'.repeat(80));
    lines.push('No active project goal. To start:');
    lines.push('');
    lines.push('1. Use orchestrator_ingest_goal to set your project goal');
    lines.push('2. The system will analyze gaps and create a roadmap');
    lines.push('3. Use orchestrator_next_target to get your first task');
    lines.push('');
  } else {
    lines.push('📋 CURRENT STATUS');
    lines.push('─'.repeat(80));
    lines.push(`State: ${currentState}`);
    lines.push(`Pending Tasks: ${pendingTasks}`);
    lines.push('');

    if (pendingTasks > 0) {
      lines.push('🎯 NEXT STEPS');
      lines.push('─'.repeat(80));
      lines.push('1. Call orchestrator_next_target to get the next task');
      lines.push('2. Review the bounded context provided');
      lines.push('3. Implement the task within the specified boundaries');
      lines.push('4. Run the verification commands');
      lines.push('5. Submit results with orchestrator_submit_result');
      lines.push('');
    } else {
      lines.push('✅ ALL TASKS COMPLETE');
      lines.push('─'.repeat(80));
      lines.push('Call orchestrator_get_score to see final project score');
      lines.push('');
    }
  }

  lines.push('📚 AVAILABLE COMMANDS');
  lines.push('─'.repeat(80));
  lines.push('  • orchestrator_ingest_goal    - Set a new project goal');
  lines.push('  • orchestrator_next_target    - Get the next task to execute');
  lines.push('  • orchestrator_submit_result  - Submit task results');
  lines.push('  • orchestrator_verify         - Run verification commands');
  lines.push('  • orchestrator_status         - Check project status');
  lines.push('  • orchestrator_get_score      - Get detailed score breakdown');
  lines.push('  • orchestrator_list_tasks     - List all tasks');
  lines.push('  • orchestrator_force_retry    - Retry a failed task');
  lines.push('');

  return lines.join('\n');
}
