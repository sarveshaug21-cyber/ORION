/**
 * ORION Agent Run Controller
 * Manages AbortControllers and cancellation for agent runs
 */

import type { AgentRunId, AgentRunStatus } from '../types/agent.js';

interface RunControllerEntry {
  abortController: AbortController;
  runId: AgentRunId;
  owner: object;
  createdAt: number;
}

export class AgentRunController {
  private readonly runs = new Map<AgentRunId, RunControllerEntry>();
  private readonly ownerIndex = new Map<object, Set<AgentRunId>>();

  /**
   * Create a new run controller with an AbortController
   */
  create(runId: AgentRunId, owner: object): AbortController {
    if (this.runs.has(runId)) {
      throw new Error(`Run controller for ${runId} already exists`);
    }

    const abortController = new AbortController();
    const entry: RunControllerEntry = {
      abortController,
      runId,
      owner,
      createdAt: Date.now(),
    };

    this.runs.set(runId, entry);
    const ownerRuns = this.ownerIndex.get(owner) ?? new Set();
    ownerRuns.add(runId);
    this.ownerIndex.set(owner, ownerRuns);

    return abortController;
  }

  /**
   * Get the AbortController for a run
   */
  get(runId: AgentRunId): AbortController | undefined {
    return this.runs.get(runId)?.abortController;
  }

  /**
   * Get the AbortSignal for a run
   */
  getSignal(runId: AgentRunId): AbortSignal | undefined {
    return this.runs.get(runId)?.abortController.signal;
  }

  /**
   * Check if a run is cancelled
   */
  isCancelled(runId: AgentRunId): boolean {
    return this.runs.get(runId)?.abortController.signal.aborted ?? false;
  }

  /**
   * Cancel a specific run
   */
  cancel(runId: AgentRunId, reason?: string): boolean {
    const entry = this.runs.get(runId);
    if (!entry) return false;

    if (!entry.abortController.signal.aborted) {
      entry.abortController.abort(reason ?? 'Cancelled by user');
    }
    return true;
  }

  /**
   * Cancel all runs owned by a specific owner (e.g., WebSocket connection)
   */
  cancelOwner(owner: object): number {
    const runIds = this.ownerIndex.get(owner);
    if (!runIds) return 0;

    let cancelled = 0;
    for (const runId of runIds) {
      if (this.cancel(runId, 'Owner disconnected')) {
        cancelled++;
      }
    }
    return cancelled;
  }

  /**
   * Remove a run controller (cleanup after terminal state)
   */
  delete(runId: AgentRunId): boolean {
    const entry = this.runs.get(runId);
    if (!entry) return false;

    this.runs.delete(runId);
    const ownerRuns = this.ownerIndex.get(entry.owner);
    if (ownerRuns) {
      ownerRuns.delete(runId);
      if (ownerRuns.size === 0) {
        this.ownerIndex.delete(entry.owner);
      }
    }
    return true;
  }

  /**
   * Get the owner for a run
   */
  getOwner(runId: AgentRunId): object | undefined {
    return this.runs.get(runId)?.owner;
  }

  /**
   * Get all active run IDs
   */
  getActiveRunIds(): AgentRunId[] {
    return Array.from(this.runs.keys());
  }

  /**
   * Get active run IDs for a specific owner
   */
  getRunIdsForOwner(owner: object): AgentRunId[] {
    return Array.from(this.ownerIndex.get(owner) ?? []);
  }

  /**
   * Clean up completed runs that are in terminal states
   * This should be called periodically or after run completion
   */
  cleanupTerminalRuns(isTerminal: (runId: AgentRunId) => boolean): number {
    let cleaned = 0;
    for (const [runId] of this.runs) {
      if (isTerminal(runId)) {
        this.delete(runId);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Get count of active runs
   */
  get size(): number {
    return this.runs.size;
  }

  /**
   * Check if a run exists
   */
  has(runId: AgentRunId): boolean {
    return this.runs.has(runId);
  }
}

/**
 * Global run controller instance
 */
export const runController = new AgentRunController();