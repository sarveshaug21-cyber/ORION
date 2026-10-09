/**
 * ORION Assistant Types
 * Core type definitions for the personal assistant layer
 */

import { z } from 'zod';
import type {
  Memory,
  Session,
  Conversation,
  ConversationMessage,
  UserSettings,
} from './index.js';
import type { AgentRun } from './agent.js';

/** Zod schemas for validation - defined first so types can reference them */

export const AssistantIntentSchema = z.enum([
  'CHAT',
  'QUESTION',
  'MEMORY_READ',
  'MEMORY_WRITE',
  'FILE_OPERATION',
  'OBSIDIAN_OPERATION',
  'TASK',
  'AGENT_TASK',
  'SYSTEM_ACTION',
  'AGENT_CONTROL',
  'CLARIFICATION_REQUIRED',
  'UNKNOWN',
]);

export const AssistantActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CHAT_RESPONSE'), content: z.string() }),
  z.object({ type: z.literal('MEMORY_READ'), query: z.string(), limit: z.number().optional() }),
  z.object({ type: z.literal('MEMORY_WRITE'), content: z.string(), category: z.string(), importance: z.number().optional(), tags: z.array(z.string()).optional() }),
  z.object({ type: z.literal('FILE_OPERATION'), operation: z.enum(['read', 'write', 'list', 'search', 'delete', 'move']), path: z.string(), content: z.string().optional(), recursive: z.boolean().optional() }),
  z.object({ type: z.literal('OBSIDIAN_OPERATION'), operation: z.enum(['search', 'read', 'create', 'update', 'list']), query: z.string().optional(), noteId: z.string().optional(), title: z.string().optional(), content: z.string().optional(), tags: z.array(z.string()).optional() }),
  z.object({ type: z.literal('TASK_OPERATION'), operation: z.enum(['create', 'list', 'complete', 'update', 'delete']), taskId: z.string().optional(), title: z.string().optional(), description: z.string().optional(), dueDate: z.string().optional(), status: z.enum(['pending', 'completed', 'cancelled']).optional() }),
  z.object({ type: z.literal('AGENT_TASK'), goal: z.string(), limits: z.object({ maxSteps: z.number().optional(), maxToolCallsPerStep: z.number().optional(), maxTotalToolCalls: z.number().optional(), maxExecutionTimeMs: z.number().optional(), stepTimeoutMs: z.number().optional(), maxTokens: z.number().optional() }).optional() }),
  z.object({ type: z.literal('AGENT_CONTROL'), operation: z.enum(['status', 'cancel', 'resume', 'list']), runId: z.string().optional() }),
  z.object({ type: z.literal('SYSTEM_ACTION'), action: z.enum(['status', 'settings', 'health']) }),
  z.object({ type: z.literal('CLARIFICATION'), question: z.string(), options: z.array(z.string()).optional() }),
]);

export const AssistantPreferencesSchema = z.object({
  language: z.string(),
  defaultVaultPath: z.string().optional(),
  defaultWorkingDirectory: z.string(),
  autoSaveMemory: z.boolean(),
  autoCreateTasks: z.boolean(),
  responseVerbosity: z.enum(['concise', 'normal', 'detailed']),
  toolConfirmationLevel: z.enum(['none', 'destructive', 'all']),
  memoryRetentionDays: z.number(),
  maxContextLength: z.number(),
});

/** Type inference from Zod schemas */
export type AssistantIntent = z.infer<typeof AssistantIntentSchema>;
export type AssistantAction = z.infer<typeof AssistantActionSchema>;
export type AssistantPreferences = z.infer<typeof AssistantPreferencesSchema>;

/** Unique identifier for an assistant session */
export type AssistantSessionId = string & { readonly __brand: unique symbol };

/** Unique identifier for an assistant message */
export type AssistantMessageId = string & { readonly __brand: unique symbol };

/** Unique identifier for a task */
export type TaskId = string & { readonly __brand: unique symbol };

/** Unique identifier for an Obsidian note */
export type ObsidianNoteId = string & { readonly __brand: unique symbol };

/** Role of a message in the assistant conversation */
export type AssistantMessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'system_status';

/** Limits for agent tasks started by the assistant */
export interface AssistantAgentLimits {
  maxSteps?: number;
  maxToolCallsPerStep?: number;
  maxTotalToolCalls?: number;
  maxExecutionTimeMs?: number;
  stepTimeoutMs?: number;
  maxTokens?: number;
}

/** Result of an assistant action */
export interface AssistantActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Assistant intent with confidence score */
export interface ClassifiedIntent {
  intent: AssistantIntent;
  confidence: number; // 0-1
  action?: AssistantAction;
  reasoning?: string;
}

/** Assistant session */
export interface AssistantSession {
  id: AssistantSessionId;
  sessionId: string; // references Session.id
  userId: string;
  conversationId: string;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
  preferences: AssistantPreferences;
  activeRunId?: string; // currently running AgentRun
}

/** Assistant message in the conversation */
export interface AssistantMessage {
  id: AssistantMessageId;
  sessionId: AssistantSessionId;
  conversationId: string;
  role: AssistantMessageRole;
  content: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
  intent?: AssistantIntent;
  actionTaken?: AssistantAction;
  actionResult?: AssistantActionResult;
  createdAt: Date;
}

/** Context for assistant processing */
export interface AssistantContext {
  session: AssistantSession;
  sessionData: Session;
  conversation: Conversation;
  conversationHistory: ConversationMessage[];
  shortTermMemories: Memory[];
  relevantMemories: Memory[];
  activeRun?: AgentRun;
  workingDirectory: string;
  allowedPaths: string[];
  userSettings: UserSettings;
  memoryStoreFactory: (sessionId: string) => any;
}

/** Assistant event types for observability */
export type AssistantEventType =
  | 'ASSISTANT_RESPONSE_STARTED'
  | 'ASSISTANT_TOOL_STARTED'
  | 'ASSISTANT_TOOL_COMPLETED'
  | 'ASSISTANT_AGENT_STARTED'
  | 'ASSISTANT_AGENT_PROGRESS'
  | 'ASSISTANT_AGENT_COMPLETED'
  | 'ASSISTANT_RESPONSE_COMPLETED'
  | 'ASSISTANT_ERROR'
  | 'ASSISTANT_INTENT_CLASSIFIED'
  | 'ASSISTANT_ACTION_TAKEN'
  | 'ASSISTANT_MEMORY_RETRIEVED'
  | 'ASSISTANT_FILE_OPERATION'
  | 'ASSISTANT_OBSIDIAN_OPERATION'
  | 'ASSISTANT_TASK_OPERATION'
  | 'ASSISTANT_AGENT_CONTROL';

/** Base event interface */
export interface AssistantEventBase {
  type: AssistantEventType;
  sessionId: AssistantSessionId;
  messageId?: AssistantMessageId;
  timestamp: string;
}

/** Payload types for each event */
export interface AssistantResponseStartedPayload {
  messageId: AssistantMessageId;
}

export interface AssistantToolStartedPayload {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface AssistantToolCompletedPayload {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface AssistantAgentStartedPayload {
  runId: string;
  goal: string;
}

export interface AssistantAgentProgressPayload {
  runId: string;
  step: number;
  status: string;
  message?: string;
}

export interface AssistantAgentCompletedPayload {
  runId: string;
  success: boolean;
  result?: string;
  error?: string;
  durationMs: number;
}

export interface AssistantResponseCompletedPayload {
  messageId: AssistantMessageId;
  actionTaken: AssistantAction;
  success: boolean;
}

export interface AssistantErrorPayload {
  error: string;
  recoverable: boolean;
  suggestions?: string[];
}

export interface AssistantIntentClassifiedPayload {
  intent: AssistantIntent;
  confidence: number;
  action?: AssistantAction;
}

export interface AssistantActionTakenPayload {
  action: AssistantAction;
  result: AssistantActionResult;
}

export interface AssistantMemoryRetrievedPayload {
  query: string;
  count: number;
}

export interface AssistantFileOperationPayload {
  operation: string;
  path: string;
  success: boolean;
}

export interface AssistantObsidianOperationPayload {
  operation: string;
  noteId?: string;
  success: boolean;
}

export interface AssistantTaskOperationPayload {
  operation: string;
  taskId?: TaskId;
  success: boolean;
}

export interface AssistantAgentControlPayload {
  operation: string;
  runId?: string;
  success: boolean;
}

/** Union of all event payloads */
export type AssistantEventPayload =
  | AssistantResponseStartedPayload
  | AssistantToolStartedPayload
  | AssistantToolCompletedPayload
  | AssistantAgentStartedPayload
  | AssistantAgentProgressPayload
  | AssistantAgentCompletedPayload
  | AssistantResponseCompletedPayload
  | AssistantErrorPayload
  | AssistantIntentClassifiedPayload
  | AssistantActionTakenPayload
  | AssistantMemoryRetrievedPayload
  | AssistantFileOperationPayload
  | AssistantObsidianOperationPayload
  | AssistantTaskOperationPayload
  | AssistantAgentControlPayload;

/** Full event with payload */
export interface AssistantEvent extends AssistantEventBase {
  payload: AssistantEventPayload;
}

/** Assistant error */
export interface AssistantError extends Error {
  code: string;
  userMessage: string;
  recoverable: boolean;
  suggestions?: string[];
  context?: Record<string, unknown>;
}

/** Create an assistant error */
export function createAssistantError(
  code: string,
  message: string,
  userMessage: string,
  options: {
    recoverable?: boolean;
    suggestions?: string[];
    context?: Record<string, unknown>;
  } = {}
): AssistantError {
  const error = new Error(message) as AssistantError;
  error.code = code;
  error.userMessage = userMessage;
  error.recoverable = options.recoverable ?? true;
  error.suggestions = options.suggestions;
  error.context = options.context;
  return error;
}

/** Token usage tracking */
export interface AssistantTokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/** Limits for assistant operation */
export interface AssistantLimits {
  maxContextTokens: number;
  maxSteps: number;
  maxToolCalls: number;
  maxExecutionTimeMs: number;
  maxMemoryRetrievals: number;
}

/** Default assistant limits */
export const DEFAULT_ASSISTANT_LIMITS: AssistantLimits = {
  maxContextTokens: 32000,
  maxSteps: 10,
  maxToolCalls: 20,
  maxExecutionTimeMs: 60000,
  maxMemoryRetrievals: 3,
};

/** Assistant request from client */
export interface AssistantRequest {
  sessionId: string;
  conversationId: string;
  userId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/** Assistant response to client */
export interface AssistantResponse {
  messageId: AssistantMessageId;
  content: string;
  intent: AssistantIntent;
  actionTaken?: AssistantAction;
  actionResult?: AssistantActionResult;
  intentConfidence: number;
  metadata?: Record<string, unknown>;
}

/** Assistant status for UI */
export interface AssistantStatus {
  sessionId: AssistantSessionId;
  status: 'idle' | 'thinking' | 'executing' | 'waiting_for_permission' | 'error';
  activeRunId?: string;
  activeRunStatus?: string;
  activeRunGoal?: string;
  lastActivity?: Date;
}

/** Obsidian vault configuration */
export interface ObsidianVaultConfig {
  vaultPath: string;
  name: string;
  enabled: boolean;
  tags?: string[];
  frontmatterKeys?: string[];
}

/** Task status */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed';

/** Task priority */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Task */
export interface Task {
  id: TaskId;
  sessionId: AssistantSessionId;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
}

/** File operation parameters */
export interface FileOperationParams {
  operation: 'read' | 'write' | 'list' | 'search' | 'delete' | 'move' | 'copy';
  path: string;
  content?: string;
  recursive?: boolean;
  pattern?: string;
  limit?: number;
}

/** Obsidian operation parameters */
export interface ObsidianOperationParams {
  operation: 'search' | 'read' | 'create' | 'update' | 'list' | 'delete';
  query?: string;
  noteId?: string;
  title?: string;
  content?: string;
  tags?: string[];
  folder?: string;
}

/** Task operation parameters */
export interface TaskOperationParams {
  operation: 'create' | 'list' | 'complete' | 'update' | 'delete';
  taskId?: TaskId;
  title?: string;
  description?: string;
  dueDate?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
}

/** Agent control parameters */
export interface AgentControlParams {
  operation: 'status' | 'cancel' | 'resume' | 'list';
  runId?: string;
}

/** Default assistant preferences */
export const AssistantPreferencesDefault: AssistantPreferences = {
  language: 'en-US',
  defaultWorkingDirectory: process.cwd(),
  autoSaveMemory: true,
  autoCreateTasks: false,
  responseVerbosity: 'normal',
  toolConfirmationLevel: 'destructive',
  memoryRetentionDays: 90,
  maxContextLength: 32000,
};