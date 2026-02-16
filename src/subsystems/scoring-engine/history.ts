/**
 * Score History
 * Manages score history persistence, trend analysis, and progress tracking
 */

import type { ScoreHistory, ScoreEntry, ScoreBreakdown, ProgressAnalysis } from '../../types/state.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export interface HistoryManagerOptions {
  projectPath: string;
  historyDir?: string;
}

export class ScoreHistoryManager {
  private historyPath: string;
  private entries: ScoreEntry[] = [];
  private trend: 'improving' | 'stable' | 'regressing' = 'stable';
  private velocity: number = 0;

  constructor(options: HistoryManagerOptions) {
    const historyDir = options.historyDir || '.orchestrator';
    this.historyPath = join(options.projectPath, historyDir, 'score-history.json');
  }

  /**
   * Initialize the history manager
   * Loads existing history if available
   */
  async init(): Promise<void> {
    await this.loadHistory();
  }

  /**
   * Add a new score entry to history
   */
  addEntry(score: number, breakdown: ScoreBreakdown, taskId: string): ScoreHistory {
    const entry: ScoreEntry = {
      timestamp: new Date(),
      score,
      breakdown,
      taskCompleted: taskId
    };

    this.entries.push(entry);
    
    // Recalculate trend and velocity
    this.trend = this.calculateTrend();
    this.velocity = this.calculateVelocity();

    // Persist to disk
    this.persistHistory().catch(err => {
      console.error('Failed to persist score history:', err);
    });

    return this.getHistory();
  }

  /**
   * Get current score history
   */
  getHistory(): ScoreHistory {
    return {
      entries: [...this.entries],
      trend: this.trend,
      velocity: this.velocity
    };
  }

  /**
   * Get the most recent score entry
   */
  getLatestEntry(): ScoreEntry | null {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
  }

  /**
   * Get entries within a date range
   */
  getEntriesInRange(startDate: Date, endDate: Date): ScoreEntry[] {
    return this.entries.filter(entry => 
      entry.timestamp >= startDate && entry.timestamp <= endDate
    );
  }

  /**
   * Calculate trend from recent entries
   */
  private calculateTrend(): 'improving' | 'stable' | 'regressing' {
    if (this.entries.length < 3) return 'stable';

    const recent = this.entries.slice(-5);
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));

    const firstAvg = firstHalf.reduce((sum, e) => sum + e.score, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, e) => sum + e.score, 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;
    if (diff > 5) return 'improving';
    if (diff < -5) return 'regressing';
    return 'stable';
  }

  /**
   * Calculate velocity (points per entry)
   */
  private calculateVelocity(): number {
    if (this.entries.length < 2) return 0;

    const recent = this.entries.slice(-5);
    if (recent.length < 2) return 0;

    const scoreDiff = recent[recent.length - 1].score - recent[0].score;
    return scoreDiff / recent.length;
  }

  /**
   * Analyze progress and provide insights
   */
  analyzeProgress(targetScore: number = 85): ProgressAnalysis {
    // Estimate completion
    let estimatedCompletion: Date | null = null;
    
    if (this.entries.length > 0 && this.velocity > 0) {
      const currentScore = this.entries[this.entries.length - 1].score;
      const remaining = targetScore - currentScore;
      
      if (remaining > 0) {
        const entriesNeeded = remaining / this.velocity;
        const daysNeeded = entriesNeeded * 0.5; // Assume 2 entries per day
        estimatedCompletion = new Date(Date.now() + daysNeeded * 24 * 60 * 60 * 1000);
      } else {
        estimatedCompletion = new Date();
      }
    }

    return {
      trend: this.trend,
      velocity: this.velocity,
      estimatedCompletion
    };
  }

  /**
   * Get score at a specific index from the end
   * e.g., index 0 = most recent, index 1 = one before that
   */
  getScoreAtIndexFromEnd(index: number): ScoreEntry | null {
    if (index >= this.entries.length) return null;
    return this.entries[this.entries.length - 1 - index];
  }

  /**
   * Get the score improvement over last N entries
   */
  getImprovementOverLastN(n: number): number {
    if (this.entries.length < 2) return 0;
    
    const recent = this.entries.slice(-n);
    if (recent.length < 2) return 0;
    
    return recent[recent.length - 1].score - recent[0].score;
  }

  /**
   * Get average score over last N entries
   */
  getAverageScore(n: number): number {
    if (this.entries.length === 0) return 0;
    
    const recent = this.entries.slice(-n);
    const sum = recent.reduce((acc, e) => acc + e.score, 0);
    return sum / recent.length;
  }

  /**
   * Clear history
   */
  clear(): void {
    this.entries = [];
    this.trend = 'stable';
    this.velocity = 0;
  }

  /**
   * Load history from disk
   */
  private async loadHistory(): Promise<void> {
    try {
      if (!existsSync(this.historyPath)) {
        return;
      }

      const data = await readFile(this.historyPath, 'utf-8');
      const parsed = JSON.parse(data);

      if (parsed.entries && Array.isArray(parsed.entries)) {
        this.entries = parsed.entries.map((e: any) => ({
          ...e,
          timestamp: new Date(e.timestamp)
        }));
        this.trend = parsed.trend || 'stable';
        this.velocity = parsed.velocity || 0;
      }
    } catch (error) {
      console.error('Failed to load score history:', error);
      this.entries = [];
      this.trend = 'stable';
      this.velocity = 0;
    }
  }

  /**
   * Persist history to disk
   */
  private async persistHistory(): Promise<void> {
    const dir = this.historyPath.substring(0, this.historyPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });

    const history: ScoreHistory = {
      entries: this.entries,
      trend: this.trend,
      velocity: this.velocity
    };

    await writeFile(this.historyPath, JSON.stringify(history, null, 2), 'utf-8');
  }
}

export { ScoreEntry, ScoreHistory, ProgressAnalysis };
