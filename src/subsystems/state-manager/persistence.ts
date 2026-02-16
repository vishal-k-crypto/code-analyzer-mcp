/**
 * State Persistence Module
 * Handles file-based state persistence with atomic writes and journaling
 * 
 * This module delegates journaling and recovery to separate specialized modules:
 * - journal.ts: Write-ahead logging
 * - recovery.ts: Crash recovery mechanisms
 */

import { promises as fs, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { OrchestratorState } from '../../types/state.js';
import { StateJournal } from './journal.js';
import { StateRecovery, createDefaultState } from './recovery.js';

export { StateJournal, JournalEntry, JournalOperation, JournalMetadata } from './journal.js';
export { StateRecovery, RecoveryResult, CheckpointInfo, createDefaultState } from './recovery.js';

export class StatePersistence {
  private basePath: string;
  private statePath: string;
  private snapshotsPath: string;
  private currentState: OrchestratorState | null = null;
  private journal: StateJournal;
  private recovery: StateRecovery;

  private projectId: string;

  constructor(projectPath: string, projectId = 'default') {
    this.projectId = projectId;
    this.basePath = join(projectPath, '.orchestrator');
    this.statePath = join(this.basePath, 'state', 'current.json');
    this.snapshotsPath = join(this.basePath, 'state', 'snapshots');
    this.journal = new StateJournal(this.basePath);
    this.recovery = new StateRecovery(this.statePath, this.snapshotsPath, this.journal);
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.basePath,
      join(this.basePath, 'state'),
      join(this.basePath, 'state', 'journal'),
      this.snapshotsPath,
      join(this.basePath, 'tasks', 'completed'),
      join(this.basePath, 'tasks', 'failed'),
      join(this.basePath, 'errors'),
      join(this.basePath, 'projects')
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
    }
  }

  /**
   * Persist state atomically with journaling
   */
  async persistState(state: OrchestratorState): Promise<void> {
    const serialized = this.serializeState(state);
    const stateHash = this.computeHash(serialized);
    const previousHash = this.currentState 
      ? this.computeHash(this.serializeState(this.currentState))
      : undefined;

    // Write to journal first (write-ahead logging)
    await this.journal.writeEntry(stateHash, 'write', previousHash);

    // Write state to temporary file with secure permissions
    const tempPath = `${this.statePath}.tmp`;
    await fs.writeFile(tempPath, serialized, { mode: 0o600 });

    // Atomic rename
    await fs.rename(tempPath, this.statePath);

    // Update current state
    this.currentState = structuredClone(state);

    // Cleanup old journal entries (keep last 50)
    await this.journal.cleanup(50);
  }

  /**
   * Load state from disk or return default
   */
  async loadState(): Promise<OrchestratorState> {
    try {
      if (!existsSync(this.statePath)) {
        return createDefaultState();
      }

      const content = await fs.readFile(this.statePath, 'utf-8');
      const state = this.deserializeState(content);
      
      // Validate loaded state
      if (!this.validateState(state)) {
        console.warn('Invalid state loaded, attempting recovery...');
        const recovery = await this.recovery.recover();
        return recovery.state || createDefaultState();
      }

      this.currentState = structuredClone(state);
      return state;
    } catch (error) {
      console.error('Failed to load state:', error);
      const recovery = await this.recovery.recover();
      return recovery.state || createDefaultState();
    }
  }

  /**
   * Create a named checkpoint
   */
  async createCheckpoint(name?: string): Promise<string> {
    if (!this.currentState) {
      throw new Error('No state to checkpoint');
    }

    const checkpointId = name || `checkpoint-${Date.now()}`;
    const checkpointFilePath = join(this.snapshotsPath, `${checkpointId}.json`);
    
    const serialized = this.serializeState(this.currentState);
    await fs.writeFile(checkpointFilePath, serialized, { mode: 0o600 });

    // Journal the checkpoint
    await this.journal.writeCheckpointEntry(checkpointId, this.computeHash(serialized));

    return checkpointId;
  }

  /**
   * Restore from checkpoint
   */
  async restoreCheckpoint(checkpointId: string): Promise<OrchestratorState> {
    const checkpointPath = join(this.snapshotsPath, `${checkpointId}.json`);
    
    if (!existsSync(checkpointPath)) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const content = await fs.readFile(checkpointPath, 'utf-8');
    const state = this.deserializeState(content);

    // Journal the restore
    await this.journal.writeRestoreEntry(checkpointId, this.computeHash(content));

    this.currentState = structuredClone(state);
    return state;
  }

  /**
   * List available checkpoints
   */
  async listCheckpoints(): Promise<string[]> {
    return this.recovery.listCheckpoints().then(checkpoints => 
      checkpoints.map(c => c.id)
    );
  }

  /**
   * Serialize state to JSON string
   * Handles Map serialization properly
   */
  private serializeState(state: OrchestratorState): string {
    return JSON.stringify(state, (_key, value) => {
      // Serialize Maps as objects with entries
      if (value instanceof Map) {
        return {
          __type: 'Map',
          data: Array.from(value.entries())
        };
      }
      return value;
    }, 2);
  }

  /**
   * Deserialize state from JSON string
   */
  private deserializeState(content: string): OrchestratorState {
    const parsed = JSON.parse(content, (_key, value) => {
      // Revive Date objects
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        return new Date(value);
      }
      // Revive Maps
      if (value && typeof value === 'object' && value.__type === 'Map') {
        return new Map(value.data);
      }
      return value;
    });

    // Convert dependencies Map if stored as plain object
    if (parsed.taskQueue?.dependencies && !(parsed.taskQueue.dependencies instanceof Map)) {
      parsed.taskQueue.dependencies = new Map(Object.entries(parsed.taskQueue.dependencies));
    }

    // Convert errorLog retryCount Map if stored as plain object
    if (parsed.errorLog?.retryCount && !(parsed.errorLog.retryCount instanceof Map)) {
      parsed.errorLog.retryCount = new Map(Object.entries(parsed.errorLog.retryCount));
    }

    return parsed;
  }

  /**
   * Validate state structure
   */
  private validateState(state: unknown): state is OrchestratorState {
    if (!state || typeof state !== 'object') return false;
    const s = state as Partial<OrchestratorState>;
    
    return (
      'progress' in s &&
      'taskQueue' in s &&
      'errorLog' in s &&
      'projectPath' in s &&
      typeof s.projectPath === 'string'
    );
  }

  /**
   * Compute simple hash for state validation
   */
  private computeHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Get the journal instance
   */
  getJournal(): StateJournal {
    return this.journal;
  }

  /**
   * Get the recovery instance
   */
  getRecovery(): StateRecovery {
    return this.recovery;
  }

  /**
   * Get project-specific directory path
   */
  private getProjectDir(): string {
    return join(this.basePath, 'projects', this.projectId);
  }

  /**
   * Save project goal to markdown file
   * Stores in .orchestrator/projects/{project-id}/goal.md
   */
  async saveProjectGoal(state: OrchestratorState): Promise<void> {
    if (!state.projectGoal) return;

    const projectDir = this.getProjectDir();
    await fs.mkdir(projectDir, { recursive: true, mode: 0o700 });

    const goalPath = join(projectDir, 'goal.md');
    const content = this.formatGoalAsMarkdown(state.projectGoal);
    await fs.writeFile(goalPath, content, { mode: 0o600 });
  }

  /**
   * Load project goal from markdown file
   */
  async loadProjectGoal(): Promise<string | null> {
    const goalPath = join(this.getProjectDir(), 'goal.md');
    try {
      return await fs.readFile(goalPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Save gaps analysis to JSON file
   * Stores in .orchestrator/projects/{project-id}/gaps.json
   */
  async saveGapsAnalysis(gaps: Array<{
    id: string;
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: string;
  }>): Promise<void> {
    const projectDir = this.getProjectDir();
    await fs.mkdir(projectDir, { recursive: true, mode: 0o700 });

    const gapsPath = join(projectDir, 'gaps.json');
    await fs.writeFile(gapsPath, JSON.stringify({
      projectId: this.projectId,
      generatedAt: new Date().toISOString(),
      gaps
    }, null, 2), { mode: 0o600 });
  }

  /**
   * Load gaps analysis from JSON file
   */
  async loadGapsAnalysis(): Promise<unknown | null> {
    const gapsPath = join(this.getProjectDir(), 'gaps.json');
    try {
      const content = await fs.readFile(gapsPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Save score history to JSON file
   * Stores in .orchestrator/projects/{project-id}/score-history.json
   */
  async saveScoreHistory(scoreHistory: {
    entries: Array<{
      timestamp: string;
      score: number;
      breakdown: Record<string, number>;
    }>;
    trend: 'improving' | 'stable' | 'regressing';
    velocity: number;
  }): Promise<void> {
    const projectDir = this.getProjectDir();
    await fs.mkdir(projectDir, { recursive: true, mode: 0o700 });

    const historyPath = join(projectDir, 'score-history.json');
    await fs.writeFile(historyPath, JSON.stringify({
      projectId: this.projectId,
      updatedAt: new Date().toISOString(),
      ...scoreHistory
    }, null, 2), { mode: 0o600 });
  }

  /**
   * Load score history from JSON file
   */
  async loadScoreHistory(): Promise<unknown | null> {
    const historyPath = join(this.getProjectDir(), 'score-history.json');
    try {
      const content = await fs.readFile(historyPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * List all project IDs with stored data
   */
  async listProjects(): Promise<string[]> {
    const projectsDir = join(this.basePath, 'projects');
    try {
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Format goal as markdown for human-readable storage
   */
  private formatGoalAsMarkdown(goal: {
    id: string;
    description: string;
    requirements: Array<{
      id: string;
      description: string;
      type: string;
      priority: string;
      acceptanceCriteria: string[];
    }>;
    constraints: Array<{
      id: string;
      description: string;
      type: string;
    }>;
    targetMetrics: {
      qualityThreshold: number;
      maxIterations: number;
      timeoutMinutes: number;
    };
    createdAt: Date;
    updatedAt: Date;
  }): string {
    const lines: string[] = [];
    
    lines.push(`# Project Goal`);
    lines.push('');
    lines.push(goal.description);
    lines.push('');
    lines.push(`**ID:** ${goal.id}`);
    lines.push(`**Created:** ${goal.createdAt.toISOString()}`);
    lines.push(`**Updated:** ${goal.updatedAt.toISOString()}`);
    lines.push('');
    
    lines.push('## Target Metrics');
    lines.push('');
    lines.push(`- Quality Threshold: ${goal.targetMetrics.qualityThreshold}%`);
    lines.push(`- Max Iterations: ${goal.targetMetrics.maxIterations}`);
    lines.push(`- Timeout: ${goal.targetMetrics.timeoutMinutes} minutes`);
    lines.push('');
    
    lines.push('## Requirements');
    lines.push('');
    for (const req of goal.requirements) {
      lines.push(`### ${req.id}`);
      lines.push('');
      lines.push(req.description);
      lines.push('');
      lines.push(`- **Type:** ${req.type}`);
      lines.push(`- **Priority:** ${req.priority}`);
      if (req.acceptanceCriteria.length > 0) {
        lines.push('- **Acceptance Criteria:**');
        for (const criteria of req.acceptanceCriteria) {
          lines.push(`  - ${criteria}`);
        }
      }
      lines.push('');
    }
    
    if (goal.constraints.length > 0) {
      lines.push('## Constraints');
      lines.push('');
      for (const constraint of goal.constraints) {
        lines.push(`- **${constraint.type}:** ${constraint.description}`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
}
