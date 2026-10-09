/**
 * ORION Agent Runtime
 * Main orchestration layer for autonomous agent execution
 */

import type {
  AgentRun,
  AgentStep,
  AgentRunId,
  AgentRunStatus,
  AgentRunLimits,
  AgentError,
  AgentRunInput,
  AgentRunEvent,
  AgentRuntimeDeps,
  AgentErrorClass,
} from '../types/agent.js';
import type { ToolExecutionContext, MemoryStore, UserSettings } from '../types/index.js';
import { runController } from './run-controller.js';
import { runStep } from './step-runner.js';
import { shouldPlan } from './planner.js';
import { createDefaultTokenBudget, hasExceededTokenBudget } from './token-budget.js';
import { classifyError } from '../types/agent.js';
import { createOrionError, DEFAULT_AGENT_LIMITS, orionErrorToAgentError } from '../types/agent.js';
import { generateId, now } from '../lib/utils.js';

/**
 * Default retry configuration
 */
const RETRY_CONFIG: Record<AgentErrorClass, { maxRetries: number; baseDelayMs: number }> = {
  MODEL_ERROR: { maxRetries: 3, baseDelayMs: 1000 },
  TOOL_ERROR: { maxRetries: 2, baseDelayMs: 1000 },
  PERMISSION_DENIED: { maxRetries: 0, baseDelayMs: 0 },
  INVALID_ARGUMENTS: { maxRetries: 1, baseDelayMs: 500 },
  TOKEN_LIMIT: { maxRetries: 1, baseDelayMs: 500 },
  PROVIDER_UNAVAILABLE: { maxRetries: 2, baseDelayMs: 2000 },
  CANCELLED: { maxRetries: 0, baseDelayMs: 0 },
  UNKNOWN: { maxRetries: 1, baseDelayMs: 1000 },
};

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a new agent step
 */
function createStep(runId: AgentRunId, stepIndex: number, generateId: () => string): AgentStep {
  const stepId = generateId() as any;
  return {
    id: stepId,
    runId,
    stepIndex,
    status: 'CREATED' as any,
    startedAt: new Date(),
    retryCount: 0,
  };
}

/**
 * Agent Runtime Implementation
 */
export class AgentRuntime {
  private readonly deps: AgentRuntimeDeps;
  private readonly listeners = new Set<(event: AgentRunEvent) => void>();
  private activeRuns = new Map<AgentRunId, { run: AgentRun; abortSignal: AbortSignal }>();

  constructor(deps: AgentRuntimeDeps) {
    this.deps = deps;
  }

  /**
   * Start a new agent run
   */
  async start(input: AgentRunInput): Promise<AgentRunId> {
    const runId = this.deps.generateId() as AgentRunId;
    const abortSignal = this.deps.createAbortSignal();

    // Create run record
    const run: AgentRun = {
      id: runId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      userId: input.userId,
      status: 'CREATED',
      goal: input.goal,
      createdAt: new Date(),
      updatedAt: new Date(),
      currentStepIndex: 0,
      totalTokensUsed: 0,
      limits: { ...DEFAULT_AGENT_LIMITS, ...input.limits },
      initialContext: {
        systemPrompt: input.initialContext?.systemPrompt ?? '',
        shortTermMemories: input.initialContext?.shortTermMemories ?? [],
        relevantMemories: input.initialContext?.relevantMemories ?? [],
        conversationHistoryLength: input.initialContext?.conversationHistoryLength ?? 0,
      },
      steps: [],
    };

    // Register run controller
    runController.create(runId, { runId });

    // Persist initial run
    await this.persistRun(run);

    // Emit RUN_STARTED event
    this.emitEvent({
      type: 'RUN_STARTED',
      runId,
      timestamp: new Date().toISOString(),
      payload: { goal: input.goal, limits: run.limits },
    });

    // Start execution in background (don't await)
    this.executeRun(run, abortSignal).catch(error => {
      console.error(`Agent run ${runId} failed:`, error);
    });

    return runId;
  }

  /**
   * Resume an interrupted run
   */
  async resume(runId: AgentRunId): Promise<void> {
    const run = await this.deps.loadRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) {
      throw new Error(`Cannot resume run in terminal state: ${run.status}`);
    }

    const abortSignal = this.deps.createAbortSignal();
    runController.create(runId, { runId });

    // Reconstruct context from completed steps
    run.status = 'OBSERVING';
    await this.persistRun(run);

    this.emitEvent({
      type: 'RUN_STARTED',
      runId,
      timestamp: new Date().toISOString(),
      payload: { goal: run.goal, limits: run.limits },
    });

    this.executeRun(run, abortSignal).catch(error => {
      console.error(`Agent run ${runId} failed on resume:`, error);
    });
  }

  /**
   * Cancel a running run
   */
  async cancel(runId: AgentRunId, reason?: string): Promise<void> {
    const controller = runController.get(runId);
    if (!controller) {
      const run = await this.deps.loadRun(runId);
      if (run && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) {
        run.status = 'CANCELLED';
        run.completedAt = new Date();
        run.finalError = orionErrorToAgentError(createOrionError('RUN_CANCELLED', reason || 'Cancelled by user', 'Run cancelled', { recoverable: false }), runId);
        await this.persistRun(run);
        this.emitEvent({
          type: 'RUN_CANCELLED',
          runId,
          timestamp: new Date().toISOString(),
          payload: { reason: reason || 'Cancelled by user', completedSteps: 0 },
        });
      }
      return;
    }

    // Abort the run
    controller.abort(reason || 'Cancelled by user');

    // Update run status
    const run = await this.deps.loadRun(runId);
    if (run) {
      run.status = 'CANCELLED';
      run.completedAt = new Date();
      run.finalError = orionErrorToAgentError(createOrionError('RUN_CANCELLED', reason || 'Cancelled by user', 'Run cancelled', { recoverable: false }), runId);
      await this.persistRun(run);
    }

    this.emitEvent({
      type: 'RUN_CANCELLED',
      runId,
      timestamp: new Date().toISOString(),
      payload: { reason: reason || 'Cancelled by user', completedSteps: 0 },
    });
  }

  /**
   * Get current run state
   */
  async getRun(runId: AgentRunId): Promise<AgentRun | null> {
    return this.deps.loadRun(runId);
  }

  /**
   * Subscribe to run events
   */
  onRunEvent(listener: (event: AgentRunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Main execution loop
   */
  private async executeRun(run: AgentRun, abortSignal: AbortSignal): Promise<void> {
    const { generateId: genId, now: nowFn } = this.deps;
    const limits = run.limits;

    // Register active run
    this.activeRuns.set(run.id, { run, abortSignal });

    // Update run status to started
    run.status = 'PLANNING';
    run.startedAt = new Date();
    run.updatedAt = new Date();
    await this.persistRun(run);

    // Load initial memories
    const memoryStore = this.deps.memoryStoreFactory(run.sessionId);
    const shortTermMemories = await memoryStore.getShortTerm(20);
    const relevantMemories = await memoryStore.searchLongTerm(run.goal, 10);

    run.initialContext = {
      ...run.initialContext,
      shortTermMemories: shortTermMemories.map((m: { content: string }) => m.content),
      relevantMemories: relevantMemories.map((m: { category: string; content: string }) => `[${m.category}] ${m.content}`),
      conversationHistoryLength: 50, // Would be loaded from conversation store
    };

    // Create token budget
    const settings = this.deps.getSettings();
    const tokenBudget = createDefaultTokenBudget(limits, settings);

    // Main loop
    let shouldContinue = true;
    let totalToolCalls = 0;
    const runStartTime = Date.now();

    while (shouldContinue && !abortSignal.aborted) {
      // Check run-level limits
      if (run.currentStepIndex >= limits.maxSteps) {
        await this.terminateRun(run, 'FAILED', orionErrorToAgentError(createOrionError(
          'MAX_STEPS_EXCEEDED',
          `Maximum steps (${limits.maxSteps}) exceeded`,
          `Agent reached maximum step limit`,
          { recoverable: false }
        ), run.id), abortSignal);
        return;
      }

      if (totalToolCalls >= limits.maxTotalToolCalls) {
        await this.terminateRun(run, 'FAILED', orionErrorToAgentError(createOrionError(
          'MAX_TOOL_CALLS_EXCEEDED',
          `Maximum total tool calls (${limits.maxTotalToolCalls}) exceeded`,
          `Agent reached maximum tool call limit`,
          { recoverable: false }
        ), run.id), abortSignal);
        return;
      }

      if (Date.now() - runStartTime > limits.maxExecutionTimeMs) {
        await this.terminateRun(run, 'FAILED', orionErrorToAgentError(createOrionError(
          'EXECUTION_TIMEOUT',
          `Execution time limit (${limits.maxExecutionTimeMs}ms) exceeded`,
          `Agent execution timed out`,
          { recoverable: false }
        ), run.id), abortSignal);
        return;
      }

      if (hasExceededTokenBudget(run, createDefaultTokenBudget(limits, settings))) {
        await this.terminateRun(run, 'FAILED', orionErrorToAgentError(createOrionError(
          'TOKEN_LIMIT',
          'Token budget exceeded',
          'Agent exceeded token budget',
          { recoverable: true }
        ), run.id), abortSignal);
        return;
      }

      // Check abort
      if (abortSignal.aborted) {
        await this.terminateRun(run, 'CANCELLED', orionErrorToAgentError(createOrionError(
          'CANCELLED',
          'Run cancelled',
          'Run cancelled by user or system',
          { recoverable: false }
        ), run.id), abortSignal);
        return;
      }

      // Create new step
      const step = createStep(run.id, run.currentStepIndex, generateId);
      run.steps.push(step);
      run.currentStepIndex = run.steps.length - 1;
      run.updatedAt = new Date(now());
      await this.persistRun(run);

      // Execute step with retry logic
      let stepResult: { step: AgentStep; shouldContinue: boolean; finalAnswer?: string; error?: AgentError } | null = null;
      let retries = 0;
      const maxRetries = 3;

      while (retries <= 3) {
        if (abortSignal.aborted) break;

        try {
          const stepDeps = {
            router: this.deps.router,
            toolRegistry: this.deps.toolRegistry,
            permissionManager: this.deps.permissionManager,
            getSettings: this.deps.getSettings,
            createExecutionContext: (r: AgentRun, s: AgentStep): ToolExecutionContext => ({
              userId: r.userId,
              sessionId: r.sessionId,
              conversationId: r.conversationId,
              workingDirectory: process.cwd(),
              allowedPaths: [process.cwd()],
              metadata: {},
              signal: abortSignal,
            }),
            eventEmitter: (event: any) => this.emitEvent(event),
            now: now,
            generateId,
          };

          stepResult = await runStep(run, step, stepDeps, abortSignal);
          break; // Success, exit retry loop
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw error;
          }

          retries++;
          const agentError = classifyError(error, { stepId: step.id });
          step.error = agentError;
          step.retryCount = retries;

          if (retries > 3 || !agentError.recoverable) {
            step.status = 'FAILED';
            await this.persistRun(run);
            await this.terminateRun(run, 'FAILED', agentError, abortSignal);
            return;
          }

          // Wait before retry with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, retries - 1), 10000);
          await sleep(delay);
        }
      }

      if (!stepResult) {
        // Should not happen, but handle gracefully
        await this.terminateRun(run, 'FAILED', orionErrorToAgentError(createOrionError(
          'UNKNOWN',
          'Step execution failed without result',
          'Internal error',
          { recoverable: false }
        ), run.id), abortSignal);
        return;
      }

      // Update run with step result
      run.steps[run.currentStepIndex] = stepResult.step;
      run.totalTokensUsed += stepResult.step.tokensUsed?.total ?? 0;
      const stepToolCalls = stepResult.step.toolCalls?.length ?? 0;
      totalToolCalls += stepToolCalls;

      if (stepResult.finalAnswer) {
        run.finalAnswer = stepResult.finalAnswer;
        shouldContinue = false;
      } else if (stepResult.error) {
        shouldContinue = false;
      } else {
        shouldContinue = stepResult.shouldContinue;
      }

      run.updatedAt = new Date(now());
      await this.persistRun(run);
    }

    // Run completed
    const currentStatus = run.status as AgentRunStatus;
    if (abortSignal.aborted && currentStatus !== 'COMPLETED' && currentStatus !== 'FAILED') {
      await this.terminateRun(run, 'CANCELLED', orionErrorToAgentError(createOrionError(
        'CANCELLED',
        'Run cancelled',
        'Run cancelled by user or system',
        { recoverable: false }
      ), run.id), abortSignal);
    } else if (currentStatus !== 'FAILED') {
      run.status = 'COMPLETED';
      run.completedAt = new Date(now());
      await this.persistRun(run);
      this.emitEvent({
        type: 'RUN_COMPLETED',
        runId: run.id,
        timestamp: new Date().toISOString(),
        payload: {
          finalAnswer: run.finalAnswer ?? '',
          totalSteps: run.steps.length,
          totalTokensUsed: run.totalTokensUsed,
          durationMs: Date.now() - runStartTime,
        },
      });
    }

    // Cleanup
    this.activeRuns.delete(run.id);
    runController.delete(run.id);
  }

  /**
   * Terminate a run with a specific status and error
   */
  private async terminateRun(
    run: AgentRun,
    status: AgentRunStatus,
    error: AgentError,
    abortSignal: AbortSignal
  ): Promise<void> {
    if (status === 'CANCELLED') {
      run.status = 'CANCELLED';
      run.completedAt = new Date();
      run.finalError = error;
      await this.persistRun(run);
      this.emitEvent({
        type: 'RUN_CANCELLED',
        runId: run.id,
        timestamp: new Date().toISOString(),
        payload: { reason: error.message, completedSteps: run.steps.filter(s => s.status === 'COMPLETED').length },
      });
    } else {
      run.status = 'FAILED';
      run.completedAt = new Date();
      run.finalError = error;
      await this.persistRun(run);
      this.emitEvent({
        type: 'RUN_FAILED',
        runId: run.id,
        timestamp: new Date().toISOString(),
        payload: {
          error,
          completedSteps: run.steps.filter(s => s.status === 'COMPLETED').length,
          totalTokensUsed: run.totalTokensUsed,
        },
      });
    }
  }

  /**
   * Emit an event to all listeners
   */
  private emitEvent(event: AgentRunEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Event listener error:', error);
      }
    }
  }

  /**
   * Persist run to database
   */
  private async persistRun(run: AgentRun): Promise<void> {
    try {
      await this.deps.persistRun(run);
    } catch (error) {
      console.error('Failed to persist run:', error);
    }
  }
}

/**
 * Factory function to create AgentRuntime with dependencies
 */
export function createAgentRuntime(deps: AgentRuntimeDeps): AgentRuntime {
  return new AgentRuntime(deps);
}