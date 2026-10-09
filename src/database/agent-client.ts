/**
 * ORION Agent Database Client
 * Prepared statements for agent run and step persistence
 */

import type { Database as BetterSqlite3Database, Statement as BetterSqlite3Statement } from 'better-sqlite3';
import type { AgentRun, AgentStep, AgentRunId, StepId, AgentRunStatus } from '../types/agent.js';

export interface AgentStatements {
  // Agent runs
  createRun: BetterSqlite3Statement;
  getRun: BetterSqlite3Statement;
  getRunBySession: BetterSqlite3Statement;
  getRunByConversation: BetterSqlite3Statement;
  updateRun: BetterSqlite3Statement;
  updateRunStatus: BetterSqlite3Statement;
  updateRunTokens: BetterSqlite3Statement;
  completeRun: BetterSqlite3Statement;
  failRun: BetterSqlite3Statement;
  cancelRun: BetterSqlite3Statement;
  getActiveRunsBySession: BetterSqlite3Statement;
  getActiveRunsByConversation: BetterSqlite3Statement;

  // Agent steps
  createStep: BetterSqlite3Statement;
  getStep: BetterSqlite3Statement;
  getStepsByRun: BetterSqlite3Statement;
  getStepByRunAndIndex: BetterSqlite3Statement;
  updateStep: BetterSqlite3Statement;
  completeStep: BetterSqlite3Statement;
  failStep: BetterSqlite3Statement;
  incrementStepRetry: BetterSqlite3Statement;
}

export function createAgentStatements(db: BetterSqlite3Database): AgentStatements {
  return {
    // Agent runs
    createRun: db.prepare(`
      INSERT INTO agent_runs (
        id, session_id, conversation_id, user_id, status, goal,
        initial_context, limits, current_step_index, total_tokens_used,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getRun: db.prepare(`SELECT * FROM agent_runs WHERE id = ?`),
    getRunBySession: db.prepare(`
      SELECT * FROM agent_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
    `),
    getRunByConversation: db.prepare(`
      SELECT * FROM agent_runs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
    `),
    updateRun: db.prepare(`
      UPDATE agent_runs SET
        status = ?, current_step_index = ?, total_tokens_used = ?,
        updated_at = ?, started_at = ?, completed_at = ?,
        final_answer = ?, final_error = ?
      WHERE id = ?
    `),
    updateRunStatus: db.prepare(`
      UPDATE agent_runs SET status = ?, updated_at = ? WHERE id = ?
    `),
    updateRunTokens: db.prepare(`
      UPDATE agent_runs SET total_tokens_used = ?, updated_at = ? WHERE id = ?
    `),
    completeRun: db.prepare(`
      UPDATE agent_runs SET
        status = 'COMPLETED',
        final_answer = ?,
        total_tokens_used = ?,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
    `),
    failRun: db.prepare(`
      UPDATE agent_runs SET
        status = 'FAILED',
        final_error = ?,
        total_tokens_used = ?,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
    `),
    cancelRun: db.prepare(`
      UPDATE agent_runs SET
        status = 'CANCELLED',
        final_error = ?,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
    `),
    getActiveRunsBySession: db.prepare(`
      SELECT * FROM agent_runs
      WHERE session_id = ?
      AND status IN ('CREATED','PLANNING','REASONING','ACTING','EXECUTING','OBSERVING')
    `),
    getActiveRunsByConversation: db.prepare(`
      SELECT * FROM agent_runs
      WHERE conversation_id = ?
      AND status IN ('CREATED','PLANNING','REASONING','ACTING','EXECUTING','OBSERVING')
    `),

    // Agent steps
    createStep: db.prepare(`
      INSERT INTO agent_steps (
        id, run_id, step_index, status, plan,
        model_input, model_output, tool_calls, tool_results,
        observation, error, tokens_prompt, tokens_completion,
        retry_count, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getStep: db.prepare(`SELECT * FROM agent_steps WHERE id = ?`),
    getStepsByRun: db.prepare(`
      SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index ASC
    `),
    getStepByRunAndIndex: db.prepare(`
      SELECT * FROM agent_steps WHERE run_id = ? AND step_index = ?
    `),
    updateStep: db.prepare(`
      UPDATE agent_steps SET
        status = ?, plan = ?, model_input = ?, model_output = ?,
        tool_calls = ?, tool_results = ?, observation = ?, error = ?,
        tokens_prompt = ?, tokens_completion = ?, retry_count = ?,
        completed_at = ?
      WHERE id = ?
    `),
    completeStep: db.prepare(`
      UPDATE agent_steps SET
        status = ?,
        completed_at = ?
      WHERE id = ?
    `),
    failStep: db.prepare(`
      UPDATE agent_steps SET
        status = 'FAILED',
        error = ?,
        completed_at = ?
      WHERE id = ?
    `),
    incrementStepRetry: db.prepare(`
      UPDATE agent_steps SET
        retry_count = retry_count + 1,
        status = ?
      WHERE id = ?
    `),
  };
}

/**
 * Row mappers
 */
export function rowToAgentRun(row: any): AgentRun {
  return {
    id: row.id as AgentRunId,
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    status: row.status as AgentRunStatus,
    goal: row.goal,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    currentStepIndex: row.current_step_index,
    totalTokensUsed: row.total_tokens_used,
    limits: JSON.parse(row.limits),
    finalAnswer: row.final_answer ?? undefined,
    finalError: row.final_error ? JSON.parse(row.final_error) : undefined,
    initialContext: row.initial_context ? JSON.parse(row.initial_context) : undefined,
    steps: [], // Loaded separately
  };
}

export function rowToAgentStep(row: any): AgentStep {
  return {
    id: row.id as StepId,
    runId: row.run_id as AgentRunId,
    stepIndex: row.step_index,
    status: row.status as AgentRunStatus,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    plan: row.plan ?? undefined,
    modelInput: row.model_input ? JSON.parse(row.model_input) : undefined,
    modelOutput: row.model_output ? JSON.parse(row.model_output) : undefined,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
    observation: row.observation ?? undefined,
    error: row.error ? JSON.parse(row.error) : undefined,
    tokensUsed: (row.tokens_prompt !== null && row.tokens_completion !== null)
      ? { prompt: row.tokens_prompt, completion: row.tokens_completion, total: row.tokens_prompt + row.tokens_completion }
      : undefined,
    retryCount: row.retry_count,
  };
}

/**
 * Convert AgentRun to database row
 */
export function agentRunToRow(run: AgentRun): any[] {
  return [
    run.id,
    run.sessionId,
    run.conversationId,
    run.userId,
    run.status,
    run.goal,
    run.initialContext ? JSON.stringify(run.initialContext) : null,
    JSON.stringify(run.limits),
    run.currentStepIndex,
    run.totalTokensUsed,
    run.createdAt.getTime(),
    run.updatedAt.getTime(),
    run.startedAt?.getTime() ?? null,
    run.completedAt?.getTime() ?? null,
  ];
}

/**
 * Convert AgentStep to database row
 */
export function agentStepToRow(step: AgentStep): any[] {
  return [
    step.id,
    step.runId,
    step.stepIndex,
    step.status,
    step.plan ?? null,
    step.modelInput ? JSON.stringify(step.modelInput) : null,
    step.modelOutput ? JSON.stringify(step.modelOutput) : null,
    step.toolCalls ? JSON.stringify(step.toolCalls) : null,
    step.toolResults ? JSON.stringify(step.toolResults) : null,
    step.observation ?? null,
    step.error ? JSON.stringify(step.error) : null,
    step.tokensUsed?.prompt ?? null,
    step.tokensUsed?.completion ?? null,
    step.retryCount,
    step.startedAt.getTime(),
    step.completedAt?.getTime() ?? null,
  ];
}