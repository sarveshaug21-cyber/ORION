/**
 * ORION Assistant Runtime
 * Main orchestration layer for the personal assistant
 * Sits ABOVE AgentRuntime and coordinates all existing systems
 */

import type {
  AssistantSession,
  AssistantMessage,
  AssistantMessageRole,
  AssistantIntent,
  AssistantAction,
  AssistantActionResult,
  AssistantContext,
  AssistantEvent,
  AssistantEventType,
  AssistantRequest,
  AssistantResponse,
  AssistantStatus,
  AssistantLimits,
  AssistantPreferences,
  ObsidianVaultConfig,
  Task,
  TaskStatus,
  TaskPriority,
  FileOperationParams,
  ObsidianOperationParams,
  TaskOperationParams,
  AgentControlParams,
  AssistantTokenUsage,
} from '../types/assistant.js';
import type {
  Session,
  Conversation,
  ConversationMessage,
  Memory,
  ToolExecutionContext,
  ToolResult,
  LLMMessage,
  UserSettings,
} from '../types/index.js';
import type { AgentRun, AgentRunId, AgentRunStatus, AgentRunEvent, AgentRunInput } from '../types/agent.js';
import type { ModelRouter } from '../ai/router/index.js';
import { AgentRuntime } from '../agent/runtime.js';
import { runController } from '../agent/run-controller.js';
import { toolRegistry } from '../tools/registry.js';
import { ToolExecutionPipeline } from '../server/tool-execution.js';
import { ToolPermissionManager } from '../server/tool-permissions.js';
import { StreamAccumulator, formatToolResult } from '../ai/streaming/index.js';
import { classifyIntent, shouldPlan } from './planner.js';
import { executeMemoryRead, executeMemoryWrite } from './memory.js';
import { executeFileOperation, executeObsidianOperation, executeTaskOperation } from './tools.js';
import { startAgentRun, resumeAgentRun, cancelAgentRun, executeAgentControl } from './agent-control.js';
import { generateResponse, generateClarification } from './response.js';
import { createAssistantError, DEFAULT_ASSISTANT_LIMITS } from '../types/assistant.js';
import { generateId, now } from '../lib/utils.js';
import { AgentRunInputSchema, AgentCancelSchema, AgentStatusSchema, AgentResumeSchema } from '../types/agent.js';

/** Default retry configuration for assistant actions */
const ASSISTANT_RETRY_CONFIG = {
  maxRetries: 2,
  baseDelayMs: 500,
};

/** Sleep utility */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a new assistant message
 */
function createAssistantMessage(
  sessionId: string,
  conversationId: string,
  role: AssistantMessageRole,
  content: string,
  options?: {
    toolCalls?: AssistantMessage['toolCalls'];
    toolCallId?: string;
    metadata?: Record<string, unknown>;
    intent?: AssistantIntent;
    actionTaken?: AssistantAction;
    actionResult?: AssistantActionResult;
  }
): AssistantMessage {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}` as any,
    sessionId: sessionId as any,
    conversationId,
    role,
    content,
    toolCalls: options?.toolCalls,
    toolCallId: options?.toolCallId,
    metadata: options?.metadata,
    intent: options?.intent,
    actionTaken: options?.actionTaken,
    actionResult: options?.actionResult,
    createdAt: new Date(),
  };
}

/**
 * Create a new assistant session
 */
function createAssistantSession(
  sessionId: string,
  userId: string,
  conversationId: string,
  preferences: AssistantPreferences
): AssistantSession {
  const nowDate = new Date();
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}` as any,
    sessionId,
    userId,
    conversationId,
    createdAt: nowDate,
    updatedAt: nowDate,
    metadata: {},
    preferences,
    activeRunId: undefined,
  };
}

/**
 * Assistant Runtime - Main orchestration layer
 */
export class AssistantRuntime {
  private readonly deps: any; // AssistantRuntimeDeps
  private readonly listeners = new Set<(event: any) => void>();
  private sessions = new Map<string, AssistantSession>(); // keyed by sessionId (Session.id)
  private messages = new Map<string, AssistantMessage[]>(); // keyed by sessionId
  private activeSessions = new Map<string, { abortController: AbortController }>(); // keyed by sessionId

  constructor(deps: any) {
    this.deps = deps;
  }

  /**
   * Get or create an assistant session
   */
  private async getOrCreateAssistantSession(
    sessionId: string,
    conversationId: string,
    userId: string,
    preferences: AssistantPreferences
  ): Promise<AssistantSession> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = createAssistantSession(sessionId, userId, conversationId, preferences);
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /**
   * Process a user message and produce a response
   */
  async processMessage(request: any): Promise<any> {
    const { sessionId, conversationId, userId, content, metadata } = request;

    // Get or create assistant session
    const preferences = this.deps.getSettings() as any;
    const assistantSession = await this.getOrCreateAssistantSession(
      sessionId,
      conversationId,
      userId,
      preferences
    );

    // Create abort signal for this request
    const abortController = new AbortController();
    const abortSignal = abortController.signal;

    // Track active session
    this.activeSessions.set(sessionId, { abortController });

    // Get session data
    const sessionData = await this.deps.getSession?.(sessionId);
    const conversation = await this.deps.getConversation?.(conversationId);
    const conversationHistory = await this.deps.getConversationHistory?.(conversationId, 50) || [];
    const memoryStore = this.deps.memoryStoreFactory(sessionId);
    const shortTermMemories = await memoryStore.getShortTerm(20);
    const relevantMemories = await memoryStore.searchLongTerm(content, 10);

    // Build context
    const context: any = {
      session: assistantSession,
      sessionData: sessionData!,
      conversation: conversation!,
      conversationHistory,
      shortTermMemories,
      relevantMemories,
      activeRun: assistantSession.activeRunId ? await this.deps.loadAgentRun?.(assistantSession.activeRunId) : undefined,
      workingDirectory: sessionData?.workingDirectory || process.cwd(),
      allowedPaths: [sessionData?.workingDirectory || process.cwd()],
      userSettings: this.deps.getSettings(),
      memoryStoreFactory: this.deps.memoryStoreFactory,
      sessionId: sessionId,
    };

    // Create user message
    const userMessage = createAssistantMessage(
      assistantSession.id,
      conversationId,
      'user',
      content,
      { metadata }
    );
    this.addMessage(assistantSession.id, userMessage);

    // Emit response started event
    this.emitEvent({
      type: 'ASSISTANT_RESPONSE_STARTED',
      sessionId: assistantSession.id,
      messageId: userMessage.id,
      timestamp: new Date().toISOString(),
      payload: { messageId: userMessage.id },
    });

    // Classify intent
    const classified = await classifyIntent(content, { sessionId: assistantSession.id, conversationHistory });
    this.emitEvent({
      type: 'ASSISTANT_INTENT_CLASSIFIED',
      sessionId: assistantSession.id,
      messageId: userMessage.id,
      timestamp: new Date().toISOString(),
      payload: { intent: classified.intent, confidence: classified.confidence, action: classified.action },
    });

    // Determine action
    let action = classified.action;
    let actionResult: any = { success: false, error: 'No action determined' };

    try {
      // Check if clarification is needed
      if (classified.intent === 'CLARIFICATION_REQUIRED' || !action) {
        const clarification = await generateClarification(content, context, classified);
        action = { type: 'CLARIFICATION', question: clarification.question, options: clarification.options };
        actionResult = { success: true, data: clarification };
      } else {
        // Execute the determined action
        actionResult = await this.executeAction(action, context, abortSignal);
      }
    } catch (error) {
      actionResult = this.handleError(error);
    }

    // Create assistant response message
    const responseContent = await generateResponse(content, context, classified.intent, action!, actionResult);
    const assistantMessage = createAssistantMessage(
      assistantSession.id,
      conversationId,
      'assistant',
      responseContent,
      { intent: classified.intent, actionTaken: action, actionResult }
    );
    this.addMessage(assistantSession.id, assistantMessage);

    // Emit response completed event
    this.emitEvent({
      type: 'ASSISTANT_RESPONSE_COMPLETED',
      sessionId: assistantSession.id,
      messageId: assistantMessage.id,
      timestamp: new Date().toISOString(),
      payload: { messageId: assistantMessage.id, actionTaken: action!, success: actionResult.success },
    });

    // Cleanup
    this.activeSessions.delete(sessionId);

    return {
      messageId: assistantMessage.id,
      content: responseContent,
      intent: classified.intent,
      actionTaken: action,
      actionResult,
      intentConfidence: classified.confidence,
      metadata: { sessionId: assistantSession.id, conversationId },
    };
  }

  /**
   * Execute an assistant action
   */
  private async executeAction(
    action: any,
    context: any,
    abortSignal: AbortSignal
  ): Promise<any> {
    switch (action.type) {
      case 'CHAT_RESPONSE':
        return { success: true, data: action.content };

      case 'MEMORY_READ':
        return await executeMemoryRead(action, context);

      case 'MEMORY_WRITE':
        return await executeMemoryWrite(action, context);

      case 'FILE_OPERATION':
        return await executeFileOperation(action, context);

      case 'OBSIDIAN_OPERATION':
        return await executeObsidianOperation(action, context);

      case 'TASK_OPERATION':
        return await executeTaskOperation(action, context);

      case 'AGENT_TASK':
        return await startAgentRun(action, context, this.deps);

      case 'AGENT_CONTROL':
        return await executeAgentControl(action, context, this.deps);

      case 'SYSTEM_ACTION':
        return await this.executeSystemAction(action, context);

      case 'CLARIFICATION':
        return { success: true, data: action };

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  }

  /**
   * Execute system action
   */
  private async executeSystemAction(
    action: any,
    context: any
  ): Promise<any> {
    switch (action.action) {
      case 'status': {
        const session = context.sessionData;
        return { success: true, data: { sessionId: session.id, workingDirectory: session.workingDirectory } };
      }
      case 'settings':
        return { success: true, data: this.deps.getSettings() };
      case 'health':
        return { success: true, data: { status: 'ok', timestamp: new Date().toISOString() } };
      default:
        return { success: false, error: `Unknown system action: ${action.action}` };
    }
  }

  /**
   * Handle errors and classify them
   */
  private handleError(error: unknown): any {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { success: false, error: 'Operation cancelled' };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metadata: { recoverable: true, suggestions: ['Please try again'] },
    };
  }

  /**
   * Add a message to the session's message history
   */
  private addMessage(sessionId: string, message: AssistantMessage): void {
    const messages = this.messages.get(sessionId) || [];
    messages.push(message);
    this.messages.set(sessionId, messages);
  }

  /**
   * Get message history for a session
   */
  getMessageHistory(sessionId: string): any[] {
    return this.messages.get(sessionId) || [];
  }

  /**
   * Get assistant session status
   */
  async getStatus(sessionId: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    let activeRunId = session.activeRunId;
    let activeRunStatus: string | undefined;
    let activeRunGoal: string | undefined;

    if (activeRunId) {
      const run = await this.deps.loadAgentRun?.(activeRunId as any);
      if (run) {
        activeRunStatus = run.status;
        activeRunGoal = run.goal;
      }
    }

    return {
      sessionId: session.id,
      status: 'idle',
      activeRunId,
      activeRunStatus,
      activeRunGoal,
      lastActivity: session.updatedAt,
    };
  }

  /**
   * Cancel current operation
   */
  async cancel(sessionId: string, reason?: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (active) {
      active.abortController.abort(reason || 'Cancelled by user');
    }

    // Also cancel any active agent run
    const session = this.sessions.get(sessionId);
    if (session?.activeRunId) {
      await this.deps.cancelAgentRun?.(session.activeRunId, reason);
    }
  }

  /**
   * Subscribe to assistant events
   */
  onEvent(listener: (event: any) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners
   */
  private emitEvent(event: any): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Assistant event listener error:', error);
      }
    }
  }
}

/**
 * Factory function to create AssistantRuntime with dependencies
 */
export function createAssistantRuntime(deps: any): AssistantRuntime {
  return new AssistantRuntime(deps);
}