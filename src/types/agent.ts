/**
 * ORION Agent Runtime Types
 * Core type definitions for autonomous agent execution
 */

import type {
  ToolCall,
  ToolResult,
  LLMMessage,
  LLMToolCall,
  UserSettings,
  OrionError,
} from './index.js';
import { createOrionError } from './index.js';

export type { ToolCall, ToolResult, LLMMessage, LLMToolCall };
export { createOrionError };

/**
 * Convert an OrionError to an AgentError by adding classification
 */
export function orionErrorToAgentError(error: OrionError, stepId?: string, toolCallId?: string) {
  return {
    ...error,
    class: 'TOOL_ERROR' as const,
    recoverable: error.recoverable ?? true,
    stepId: stepId as any,
    toolCallId,
  };
}

/** Unique identifier for an agent run */
export type AgentRunId = string & { readonly __brand: unique symbol };

/** Unique identifier for a step within a run */
export type StepId = string & { readonly __brand: unique symbol };

/** High-level agent run status */
export type AgentRunStatus =
  | 'CREATED'
  | 'PLANNING'
  | 'REASONING'
  | 'ACTING'
  | 'EXECUTING'
  | 'OBSERVING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** Error classification for retry logic */
export type AgentErrorClass =
  | 'MODEL_ERROR'
  | 'TOOL_ERROR'
  | 'PERMISSION_DENIED'
  | 'INVALID_ARGUMENTS'
  | 'TOKEN_LIMIT'
  | 'PROVIDER_UNAVAILABLE'
  | 'CANCELLED'
  | 'UNKNOWN';

/** Structured agent error with classification */
export interface AgentError extends Error {
  class: AgentErrorClass;
  recoverable: boolean;
  stepId?: StepId;
  toolCallId?: string;
  suggestions?: string[];
  context?: Record<string, unknown>;
}

/** Token usage tracking */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/** A single step in the agent run */
export interface AgentStep {
  id: StepId;
  runId: AgentRunId;
  stepIndex: number;
  status: AgentRunStatus;
  startedAt: Date;
  completedAt?: Date;
  plan?: string;
  modelInput?: {
    messageCount: number;
    hasSystemPrompt: boolean;
    hasToolResults: boolean;
  };
  modelOutput?: {
    contentLength: number;
    toolCallCount: number;
  };
  toolCalls?: ToolCall[];
  toolResults?: Array<{
    toolCall: ToolCall;
    result: ToolResult;
  }>;
  observation?: string;
  tokensUsed?: TokenUsage;
  error?: AgentError;
  retryCount: number;
}

/** Configurable limits for an agent run */
export interface AgentRunLimits {
  maxSteps: number;
  maxToolCallsPerStep: number;
  maxTotalToolCalls: number;
  maxExecutionTimeMs: number;
  stepTimeoutMs: number;
  maxTokens?: number;
}

/** Complete agent run record */
export interface AgentRun {
  id: AgentRunId;
  sessionId: string;
  conversationId: string;
  userId: string;
  status: AgentRunStatus;
  goal: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  currentStepIndex: number;
  totalTokensUsed: number;
  limits: AgentRunLimits;
  finalAnswer?: string;
  finalError?: AgentError;
  initialContext?: {
    systemPrompt?: string;
    shortTermMemories: string[];
    relevantMemories: string[];
    conversationHistoryLength: number;
  };
  steps: AgentStep[];
}

/** Agent run event types for observability */
export type AgentRunEventType =
  | 'RUN_STARTED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED'
  | 'RUN_CANCELLED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_FAILED'
  | 'PLAN_UPDATED'
  | 'TOOL_CALLS_READY'
  | 'TOOLS_DISPATCHED'
  | 'TOOLS_COMPLETED'
  | 'OBSERVATION_GENERATED';

/** Base event interface */
export interface AgentRunEventBase {
  type: AgentRunEventType;
  runId: AgentRunId;
  stepId?: StepId;
  timestamp: string;
}

/** Payload types for each event */
export interface RunStartedPayload {
  goal: string;
  limits: AgentRunLimits;
}

export interface RunCompletedPayload {
  finalAnswer: string;
  totalSteps: number;
  totalTokensUsed: number;
  durationMs: number;
}

export interface RunFailedPayload {
  error: AgentError;
  completedSteps: number;
  totalTokensUsed: number;
}

export interface RunCancelledPayload {
  reason?: string;
  completedSteps: number;
}

export interface StepStartedPayload {
  stepIndex: number;
  status: AgentRunStatus;
}

export interface StepCompletedPayload {
  stepIndex: number;
  hadToolCalls: boolean;
  tokensUsed: TokenUsage;
  durationMs: number;
}

export interface StepFailedPayload {
  stepIndex: number;
  error: AgentError;
  retryCount: number;
}

export interface PlanUpdatedPayload {
  plan: string;
  stepIndex: number;
}

export interface ToolCallsReadyPayload {
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  stepIndex: number;
}

export interface ToolsDispatchedPayload {
  toolCallIds: string[];
  stepIndex: number;
}

export interface ToolsCompletedPayload {
  results: Array<{
    toolCallId: string;
    success: boolean;
    hasError: boolean;
  }>;
  stepIndex: number;
}

export interface ObservationGeneratedPayload {
  observation: string;
  stepIndex: number;
}

/** Union of all event payloads */
export type AgentRunEventPayload =
  | RunStartedPayload
  | RunCompletedPayload
  | RunFailedPayload
  | RunCancelledPayload
  | StepStartedPayload
  | StepCompletedPayload
  | StepFailedPayload
  | PlanUpdatedPayload
  | ToolCallsReadyPayload
  | ToolsDispatchedPayload
  | ToolsCompletedPayload
  | ObservationGeneratedPayload;

/** Full event with payload */
export interface AgentRunEvent extends AgentRunEventBase {
  payload: AgentRunEventPayload;
}

/** Type guard helpers */
export function isTerminalStatus(status: AgentRunStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

export function isActiveStatus(status: AgentRunStatus): boolean {
  return !isTerminalStatus(status);
}

export function isRecoveryStatus(status: AgentRunStatus): boolean {
  return status === 'PLANNING' || status === 'REASONING' || status === 'ACTING' || status === 'EXECUTING' || status === 'OBSERVING';
}

/** Error classification */
export function classifyError(error: unknown, context: { stepId?: StepId; toolCallId?: string }): AgentError {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      name: 'AbortError',
      message: 'Operation aborted',
      class: 'CANCELLED',
      recoverable: false,
      stepId: context.stepId,
      toolCallId: context.toolCallId,
    };
  }

  if (error instanceof Error) {
    // Network/timeout errors
    if (error.name === 'TimeoutError' || error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return { ...error, class: 'MODEL_ERROR', recoverable: true, stepId: context.stepId, toolCallId: context.toolCallId };
    }
    if (error.message.includes('network') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      return { ...error, class: 'PROVIDER_UNAVAILABLE', recoverable: true, stepId: context.stepId, toolCallId: context.toolCallId };
    }
    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return { ...error, class: 'MODEL_ERROR', recoverable: true, stepId: context.stepId, toolCallId: context.toolCallId, suggestions: ['Wait and retry', 'Reduce request frequency'] };
    }
    if (error.message.includes('401') || error.message.includes('unauthorized') || error.message.includes('authentication')) {
      return { ...error, class: 'MODEL_ERROR', recoverable: false, stepId: context.stepId, toolCallId: context.toolCallId, suggestions: ['Check API key'] };
    }
    if (error.message.includes('context') || error.message.includes('token') || error.message.includes('too long')) {
      return { ...error, class: 'TOKEN_LIMIT', recoverable: true, stepId: context.stepId, toolCallId: context.toolCallId };
    }
    if (error.message.includes('permission') || error.message.includes('denied') || error.message.includes('PERMISSION')) {
      return { ...error, class: 'PERMISSION_DENIED', recoverable: false, stepId: context.stepId, toolCallId: context.toolCallId };
    }
    if (error.message.includes('invalid') || error.message.includes('arguments') || error.message.includes('schema')) {
      return { ...error, class: 'INVALID_ARGUMENTS', recoverable: true, stepId: context.stepId, toolCallId: context.toolCallId };
    }
    if (error.message.includes('tool') || error.message.includes('execution')) {
      return { ...error, class: 'TOOL_ERROR', recoverable: true, stepId: context.stepId, toolCallId: context.toolCallId };
    }
  }

  return {
    ...(error instanceof Error ? error : new Error(String(error))),
    class: 'UNKNOWN',
    recoverable: true,
    stepId: context.stepId,
    toolCallId: context.toolCallId,
  };
}

/** Default limits */
export const DEFAULT_AGENT_LIMITS: AgentRunLimits = {
  maxSteps: 10,
  maxToolCallsPerStep: 5,
  maxTotalToolCalls: 25,
  maxExecutionTimeMs: 5 * 60 * 1000,
  stepTimeoutMs: 2 * 60 * 1000,
};

/** Dependencies injected into AgentRuntime */
export interface AgentRuntimeDeps {
  router: any; // ModelRouter - avoid circular import
  toolRegistry: any; // ToolRegistry
  permissionManager: any; // ToolPermissionManager
  memoryStoreFactory: (sessionId: string) => any; // MemoryStore
  eventEmitter: (event: AgentRunEvent) => void;
  persistRun: (run: AgentRun) => Promise<void>;
  loadRun: (runId: AgentRunId) => Promise<AgentRun | null>;
  getSettings: () => UserSettings;
  createAbortSignal: () => AbortSignal;
  now: () => number;
  generateId: () => string;
}

/** Zod schemas for agent WebSocket messages */
import { z } from 'zod';

export const AgentRunInputSchema = z.object({
  type: z.literal('agent_start'),
  sessionId: z.string().min(1),
  conversationId: z.string().min(1),
  userId: z.string().min(1),
  goal: z.string().min(1).max(32000),
  limits: z.object({
    maxSteps: z.number().int().positive().optional(),
    maxToolCallsPerStep: z.number().int().positive().optional(),
    maxTotalToolCalls: z.number().int().positive().optional(),
    maxExecutionTimeMs: z.number().int().positive().optional(),
    stepTimeoutMs: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
  }).optional(),
  initialContext: z.object({
    systemPrompt: z.string().optional(),
    shortTermMemories: z.array(z.string()).optional(),
    relevantMemories: z.array(z.string()).optional(),
    conversationHistoryLength: z.number().int().nonnegative().optional(),
  }).optional(),
});

export const AgentCancelSchema = z.object({
  type: z.literal('agent_cancel'),
  runId: z.string().min(1),
  reason: z.string().optional(),
});

export const AgentStatusSchema = z.object({
  type: z.literal('agent_status'),
  runId: z.string().min(1),
});

export const AgentResumeSchema = z.object({
  type: z.literal('agent_resume'),
  runId: z.string().min(1),
});

export type AgentRunInput = z.infer<typeof AgentRunInputSchema>;
export type AgentCancelInput = z.infer<typeof AgentCancelSchema>;
export type AgentStatusInput = z.infer<typeof AgentStatusSchema>;
export type AgentResumeInput = z.infer<typeof AgentResumeSchema>;