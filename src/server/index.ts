/**
 * ORION Server
 * Main entry point for the backend server
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { registerBuiltinTools } from '../tools/index.js';
import { toolRegistry } from '../tools/registry.js';
import { loadBuiltinSkills } from '../skills/index.js';
import { createRouter } from '../ai/router/index.js';
import { stmt, now, rowToSession, rowToConversation } from '../database/client.js';
import { createMemoryStore } from '../features/memory/store.js';
import { generateId } from '../lib/utils.js';
import type {
  Session,
  Conversation,
  AIActivity,
  UserSettings,
  LLMMessage,
  ToolExecutionContext,
  ToolResult,
  ConversationMessage,
} from '../types/index.js';
import {
  ChatRequestSchema,
  PermissionResponseSchema,
  type ToolExecutionEvent,
} from '../types/tool-events.js';
import { StreamAccumulator, formatToolResult } from '../ai/streaming/index.js';
import { ToolExecutionPipeline } from './tool-execution.js';
import { ToolPermissionManager } from './tool-permissions.js';
import { createAgentRuntime } from '../agent/runtime.js';
import { createAssistantRuntime } from '../assistant/runtime.js';
import type { AgentRunEvent } from '../types/agent.js';
import { AgentRunInputSchema, AgentCancelSchema, AgentStatusSchema, AgentResumeSchema } from '../types/agent.js';
import type { AgentRunId } from '../types/agent.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const WS_PATH = '/ws';

// Initialize core systems
registerBuiltinTools();
// loadBuiltinSkills() is async - call it in init()

// Create model router
const router = createRouter({
  models: [
    {
      provider: 'openai-compatible',
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      role: 'primary',
      enabled: true,
    },
  ],
  defaultProvider: 'openai-compatible',
});

// Session management
const sessions = new Map<string, Session>();
const activeConnections = new Map<string, Set<WebSocket>>();
const permissionManager = new ToolPermissionManager();
const activeRequests = new Set<string>();
const completedRequests = new Set<string>();
const MAX_TOOL_ROUNDS = 5;

// Agent Runtime
const agentRuntime = createAgentRuntime({
  router,
  toolRegistry,
  permissionManager,
  memoryStoreFactory: createMemoryStore,
  eventEmitter: (event) => {
    // Broadcast agent run events to all connections in the session
    // For simplicity, broadcast to all connections (in production, filter by session)
    for (const [, connections] of activeConnections) {
      for (const ws of connections) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'agent_event', event }));
        }
      }
    }
  },
  persistRun: async (run) => {
    // Persistence is handled by the runtime's internal persistRun
    // which uses the database client
  },
  loadRun: async (runId) => {
    // This would need a database query - for now return null
    // In a full implementation, this would query the agent_runs table
    return null;
  },
  getSettings: () => defaultSettings,
  createAbortSignal: () => new AbortController().signal,
  now: () => Date.now(),
  generateId: () => `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`,
});

// Assistant Runtime
const assistantRuntime = createAssistantRuntime({
  router,
  toolRegistry,
  permissionManager,
  memoryStoreFactory: createMemoryStore,
  eventEmitter: (event: any) => {
    // Broadcast assistant events to all connections in the session
    for (const [, connections] of activeConnections) {
      for (const ws of connections) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'assistant_event', event }));
        }
      }
    }
  },
  persistRun: async (run: any) => {
    // Persistence is handled by the runtime's internal persistRun
  },
  loadRun: async (runId: string) => {
    return null;
  },
  getSettings: () => defaultSettings,
  createAbortSignal: () => new AbortController().signal,
  now: () => Date.now(),
  generateId: () => `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`,
  getSession: async (sessionId: string) => {
    const session = sessions.get(sessionId);
    return session || null;
  },
  getConversation: async (conversationId: string) => {
    const conversation = stmt.getConversation.get(conversationId) as any;
    return conversation ? rowToConversation(conversation) : null;
  },
  getConversationHistory: async (conversationId: string, limit?: number) => {
    const memoryStore = createMemoryStore('default');
    return memoryStore.getConversationHistory(conversationId, limit || 50);
  },
  loadAgentRun: async (runId: string) => {
    return null;
  },
  cancelAgentRun: async (runId: string, reason?: string) => {
    await agentRuntime.cancel(runId as any, reason);
  },
});

// Default settings
const defaultSettings: UserSettings = {
  ai: {
    providers: [
      {
        baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
        apiKey: process.env.LLM_API_KEY || '',
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
      },
    ],
    activeProvider: 'openai-compatible',
    modelRouting: [],
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: `You are ORION, a futuristic personal AI computer assistant. You help users interact with their computer through natural language.

Your capabilities include:
- System monitoring and control
- File system operations
- Web browsing and search
- Terminal command execution
- Memory management
- Skill-based extensibility

Always be helpful, precise, and transparent about what you're doing. Show your reasoning and tool usage.`,
  },
  voice: {
    enabled: false,
    speechToText: 'browser',
    textToSpeech: 'browser',
    language: 'en-US',
    autoListen: false,
  },
  memory: {
    shortTermLimit: 50,
    longTermRetentionDays: 90,
    autoSaveFromConversation: true,
    importanceThreshold: 30,
    enableEmbeddings: false,
  },
  permissions: {
    defaultLevel: 'READ_ONLY',
    allowedPaths: [process.cwd()],
    blockedPaths: ['/etc', '/var', '/usr', '/bin', '/sbin', '/root', '/home'],
    requireConfirmationFor: ['REQUIRES_CONFIRMATION'],
    trustedTools: [],
  },
  appearance: {
    theme: 'dark',
    accentColor: '#06b6d4',
    fontSize: 14,
    compactMode: false,
    animationsEnabled: true,
    glassmorphism: true,
  },
  shortcuts: {
    commandPalette: 'Meta+K',
    newConversation: 'Meta+N',
    toggleVoice: 'Meta+V',
    toggleSettings: 'Meta+,',
    focusInput: 'Meta+L',
    cancelGeneration: 'Escape',
  },
  advanced: {
    debugMode: false,
    logLevel: 'info',
    telemetryEnabled: false,
    experimentalFeatures: [],
  },
};

// Load or create default session
async function getOrCreateSession(): Promise<Session> {
  const existing = stmt.getSessionByUser.get('default') as any;
  if (existing) {
    const session = rowToSession(existing);
    sessions.set(session.id, session);
    return session;
  }

  const session: Session = {
    id: generateId(),
    userId: 'default',
    createdAt: new Date(),
    updatedAt: new Date(),
    workingDirectory: process.cwd(),
    config: {
      autoSaveMemory: true,
      maxShortTermMemory: 50,
      defaultPermissionLevel: 'READ_ONLY',
      voiceEnabled: false,
      language: 'en-US',
      theme: 'dark',
    },
    metadata: {},
  };

  stmt.createSession.run(
    session.id,
    session.userId,
    session.createdAt.getTime(),
    session.updatedAt.getTime(),
    session.workingDirectory,
    JSON.stringify(session.config),
    JSON.stringify(session.metadata)
  );

  sessions.set(session.id, session);
  return session;
}

// Activity logging
function logActivity(sessionId: string, activity: Omit<AIActivity, 'id' | 'timestamp'>): void {
  const id = generateId();
  const timestamp = now();

  stmt.addActivity.run(id, sessionId, activity.type, timestamp, activity.message, activity.data ? JSON.stringify(activity.data) : null, activity.level);
}

// Main message processing
async function processMessage(
  sessionId: string,
  conversationId: string,
  userMessage: string,
  connection: WebSocket
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found');

  const memoryStore = createMemoryStore(sessionId);
  const conversationHistory = await memoryStore.getConversationHistory(conversationId, 50);
  const shortTermMemories = await memoryStore.getShortTerm(20);
  const relevantMemories = await memoryStore.searchLongTerm(userMessage, 10);

  // Build system prompt with context
  let systemPrompt = defaultSettings.ai.systemPrompt;

  // Add memory context
  if (shortTermMemories.length > 0) {
    systemPrompt += '\n\nShort-term context:\n' + shortTermMemories.map((m) => `- ${m.content}`).join('\n');
  }

  if (relevantMemories.length > 0) {
    systemPrompt += '\n\nRelevant memories:\n' + relevantMemories.map((m) => `- [${m.category}] ${m.content}`).join('\n');
  }

  // Prepare messages for LLM
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...conversationHistory.map((m): LLMMessage => ({
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
      ...(m.toolCalls && { toolCalls: m.toolCalls }),
      ...(m.toolCallId && { toolCallId: m.toolCallId }),
    })),
  ];

  const tools = toolRegistry.list().map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));

  logActivity(sessionId, {
    type: 'thinking',
    message: 'Processing request...',
    level: 'info',
  });

  const context: ToolExecutionContext = {
    userId: session.userId,
    sessionId,
    conversationId,
    workingDirectory: session.workingDirectory || process.cwd(),
    allowedPaths: [session.workingDirectory || process.cwd()],
    metadata: {},
  };
  const executedToolIds = new Set<string>();
  let responseContent = '';
  let finalMessageContent = '';

  const executionPipeline = new ToolExecutionPipeline({
    registry: toolRegistry,
    requestPermission: (request) =>
      permissionManager.request(request.id, sessionId, connection),
    onEvent: (event) => persistToolEvent(sessionId, event),
    emit: (event) => {
      const message = { type: 'tool_event', event };
      if (event.type === 'TOOL_PERMISSION_REQUIRED') {
        sendToConnection(connection, message);
      } else {
        broadcast(sessionId, message);
      }
      if (event.type === 'TOOL_PERMISSION_REQUIRED') {
        sendToConnection(connection, {
          type: 'permission_request',
          toolCall: {
            id: event.id,
            toolName: event.toolName,
            arguments: event.arguments || {},
            action: event.action,
          },
        });
      }
    },
  });

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const stream = new StreamAccumulator();
    for await (const chunk of router.streamComplete({
      messages,
      tools,
      toolChoice: round === MAX_TOOL_ROUNDS ? 'none' : 'auto',
      temperature: defaultSettings.ai.temperature,
    })) {
      stream.process(chunk);
      const text = chunk.choices[0]?.delta.content;
      if (text) {
        responseContent += text;
        broadcast(sessionId, { type: 'stream_chunk', content: text });
      }
    }

    const content = stream.getContent();
    const toolCalls = stream.getToolCalls();
    if (toolCalls.length === 0) {
      finalMessageContent = content;
      break;
    }

    const assistantToolMessage: LLMMessage = {
      role: 'assistant',
      content,
      toolCalls,
    };
    messages.push(assistantToolMessage);
    await appendConversationMessage(sessionId, conversationId, {
      id: generateId(),
      conversationId,
      role: 'assistant',
      content,
      toolCalls,
      metadata: {},
      createdAt: new Date(),
    });

    for (const toolCall of toolCalls) {
      const duplicate = executedToolIds.has(toolCall.id);
      executedToolIds.add(toolCall.id);
      const parsedArgs = parseToolCallArguments(toolCall.function.arguments);
      const args = parsedArgs.arguments;
      const result: ToolResult = await executionPipeline.execute({
        id: duplicate ? generateId() : toolCall.id,
        toolName: toolCall.function.name,
        arguments: args,
        conversationId,
        context,
        requireConfirmationFor: defaultSettings.permissions.requireConfirmationFor,
        ...(parsedArgs.error ? { invalidArguments: parsedArgs.error } : {}),
        ...(duplicate ? { blockedReason: 'Duplicate tool call identifier; execution was prevented.' } : {}),
        ...(round === MAX_TOOL_ROUNDS
          ? { blockedReason: 'Tool-call limit reached; no further tool execution was allowed.' }
          : {}),
      });

      const toolResultMessage: LLMMessage = {
        role: 'tool',
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: formatToolResult(result),
      };
      messages.push(toolResultMessage);
      await appendConversationMessage(sessionId, conversationId, {
        id: generateId(),
        conversationId,
        role: 'tool',
        content: toolResultMessage.content,
        toolCallId: toolCall.id,
        metadata: {},
        createdAt: new Date(),
      });
    }

    if (round === MAX_TOOL_ROUNDS) {
      const finalStream = new StreamAccumulator();
      for await (const chunk of router.streamComplete({
        messages,
        tools,
        toolChoice: 'none',
        temperature: defaultSettings.ai.temperature,
      })) {
        finalStream.process(chunk);
        const text = chunk.choices[0]?.delta.content;
        if (text) {
          responseContent += text;
          broadcast(sessionId, { type: 'stream_chunk', content: text });
        }
      }
      finalMessageContent = finalStream.getContent();
      break;
    }
  }

  const assistantMsg = {
    id: generateId(),
    conversationId,
    role: 'assistant' as const,
  content: finalMessageContent || responseContent,
    metadata: {},
    createdAt: new Date(),
  };

  await appendConversationMessage(sessionId, conversationId, assistantMsg);

  // Extract memories if enabled
  if (defaultSettings.memory.autoSaveFromConversation) {
    await memoryStore.addShortTerm({
      content: `User: ${userMessage}`,
      category: 'context',
      importance: 40,
      source: 'conversation',
      metadata: {},
      tags: ['conversation'],
      conversationId,
    });
    await memoryStore.addShortTerm({
      content: `ORION: ${assistantMsg.content.slice(0, 200)}`,
      category: 'context',
      importance: 40,
      source: 'conversation',
      metadata: {},
      tags: ['conversation'],
      conversationId,
    });
  }

  broadcast(sessionId, {
    type: 'complete',
    message: { ...assistantMsg, content: responseContent || assistantMsg.content },
  });
}

async function appendConversationMessage(
  sessionId: string,
  conversationId: string,
  message: ConversationMessage
): Promise<void> {
  const memoryStore = createMemoryStore(sessionId);
  await memoryStore.addConversationMessage(message);
  stmt.incrementConversationMessages.run(now(), conversationId);
}

function parseToolCallArguments(raw: string): {
  arguments: Record<string, unknown>;
  error?: string;
} {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { arguments: {}, error: 'Tool arguments must be a JSON object.' };
    }
    return { arguments: parsed as Record<string, unknown> };
  } catch {
    return { arguments: {}, error: 'Tool arguments were not valid JSON.' };
  }
}

function persistToolEvent(sessionId: string, event: ToolExecutionEvent): void {
  const timestamp = new Date(event.timestamp).getTime();

  if (event.type === 'TOOL_REQUESTED') {
    stmt.addToolCall.run(
      event.id,
      sessionId,
      event.conversationId,
      event.toolName,
      JSON.stringify(event.arguments || {}),
      'pending',
      timestamp,
      0
    );
    logActivity(sessionId, {
      type: 'tool_call',
      message: `Requested ${event.toolName}`,
      data: { toolName: event.toolName, arguments: event.arguments },
      level: 'info',
    });
    return;
  }

  if (event.type === 'TOOL_PERMISSION_REQUIRED') {
    stmt.setToolCallPermissionRequired.run(event.id);
    logActivity(sessionId, {
      type: 'permission_request',
      message: `Permission required for ${event.toolName}`,
      data: { toolName: event.toolName, arguments: event.arguments },
      level: 'warning',
    });
    return;
  }

  if (event.type === 'TOOL_STARTED') {
    stmt.setToolCallStarted.run(timestamp, event.id);
    return;
  }

  if (event.type === 'TOOL_RESULT') {
    stmt.setToolCallResult.run(JSON.stringify(event.result), event.id);
    logActivity(sessionId, {
      type: 'tool_result',
      message: `${event.toolName} returned ${event.status}`,
      data: { toolName: event.toolName, status: event.status },
      level: event.status === 'completed' ? 'success' : 'error',
    });
    return;
  }

  if (event.type === 'TOOL_ERROR') {
    logActivity(sessionId, {
      type: 'error',
      message: `${event.toolName} failed`,
      data: { toolName: event.toolName, error: event.error },
      level: 'error',
    });
    return;
  }

  if (event.type === 'TOOL_COMPLETED') {
    const status = event.status === 'completed' ? 'completed' : 'failed';
    const result =
      event.status === 'denied'
        ? JSON.stringify({ success: false, error: event.error || 'Permission denied.' })
        : undefined;
    stmt.updateToolCall.run(status, result || null, timestamp, event.id);
  }
}

// WebSocket broadcasting
function broadcast(sessionId: string, message: unknown): void {
  const connections = activeConnections.get(sessionId);
  if (!connections) return;
  const serialized = JSON.stringify(message);
  for (const connection of connections) {
    if (connection.readyState === WebSocket.OPEN) {
      connection.send(serialized);
    }
  }
}

// HTTP server for health checks
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// WebSocket server
const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on('connection', (ws) => {
  let sessionId: string | null = null;

  ws.on('close', () => {
    permissionManager.cancelOwner(ws);
    if (!sessionId) return;
    const connections = activeConnections.get(sessionId);
    connections?.delete(ws);
    if (connections?.size === 0) activeConnections.delete(sessionId);
  });

  ws.on('message', (data) => {
    if (!sessionId) {
      sendToConnection(ws, { type: 'error', error: 'ORION session is still initializing.' });
      return;
    }
    void handleWebSocketMessage(ws, sessionId, data.toString());
  });

  void (async () => {
    try {
      const session = await getOrCreateSession();
      if (ws.readyState !== WebSocket.OPEN) return;
      sessionId = session.id;
      const connections = activeConnections.get(sessionId) || new Set<WebSocket>();
      connections.add(ws);
      activeConnections.set(sessionId, connections);
      sendToConnection(ws, { type: 'connected', sessionId });
    } catch (error) {
      sendToConnection(ws, {
        type: 'error',
        error: error instanceof Error ? error.message : 'Failed to initialize ORION session.',
      });
      ws.close();
    }
  })();
});

async function handleWebSocketMessage(
  ws: WebSocket,
  sessionId: string,
  rawMessage: string
): Promise<void> {
  try {
    const message: unknown = JSON.parse(rawMessage);
    if (!message || typeof message !== 'object' || !('type' in message)) {
      throw new Error('Invalid WebSocket message.');
    }
    const envelope = message as Record<string, unknown>;

    switch (envelope.type) {
      case 'chat': {
        const request = ChatRequestSchema.safeParse(message);
        if (!request.success) {
          sendToConnection(ws, { type: 'error', error: 'Invalid chat request.' });
          return;
        }
        const requestId = request.data.requestId || generateId();
        const requestKey = `${sessionId}:${requestId}`;
        if (activeRequests.has(requestKey) || completedRequests.has(requestKey)) return;
        activeRequests.add(requestKey);

        try {
          const session = await getOrCreateSession();
          const conversation = getOrCreateConversation(
            session.id,
            request.data.conversationId,
            request.data.content
          );
          const userMessage: ConversationMessage = {
            id: generateId(),
            conversationId: conversation.id,
            role: 'user',
            content: request.data.content,
            metadata: {},
            createdAt: new Date(),
          };
          await appendConversationMessage(session.id, conversation.id, userMessage);
          
          // Use AssistantRuntime for processing the message
          const response = await assistantRuntime.processMessage({
            sessionId: session.id,
            conversationId: conversation.id,
            userId: session.userId,
            content: request.data.content,
          });
          
          // Send the response back to the client
          sendToConnection(ws, {
            type: 'assistant_response',
            messageId: response.messageId,
            content: response.content,
            intent: response.intent,
            actionTaken: response.actionTaken,
            actionResult: response.actionResult,
            intentConfidence: response.intentConfidence,
            metadata: response.metadata,
          });
        } finally {
          rememberCompletedRequest(requestKey);
          activeRequests.delete(requestKey);
        }
        return;
      }

      case 'permission_response': {
        const response = PermissionResponseSchema.safeParse(message);
        if (
          !response.success ||
          !permissionManager.respond(
            response.success ? response.data.toolCallId : '',
            sessionId,
            ws,
            response.success ? response.data.granted : false
          )
        ) {
          sendToConnection(ws, {
            type: 'error',
            error: 'This permission request is no longer active.',
          });
        }
        return;
      }

      case 'get_sessions': {
        const session = await getOrCreateSession();
        sendToConnection(ws, { type: 'sessions', sessions: [session] });
        return;
      }

      case 'get_conversations': {
        const rows = stmt.getConversationsBySession.all(sessionId, 50) as any[];
        sendToConnection(ws, {
          type: 'conversations',
          conversations: rows.map(rowToConversation),
        });
        return;
      }

      case 'get_settings':
        sendToConnection(ws, { type: 'settings', settings: defaultSettings });
        return;

      case 'update_settings':
        if (!envelope.settings || typeof envelope.settings !== 'object') {
          sendToConnection(ws, { type: 'error', error: 'Invalid settings update.' });
          return;
        }
        Object.assign(defaultSettings, envelope.settings);
        sendToConnection(ws, { type: 'settings_updated', settings: defaultSettings });
        return;

      case 'system_status': {
        const session = sessions.get(sessionId);
        if (!session) throw new Error('Session not found.');
        const result = await systemTools[0].execute({}, {
          userId: session.userId,
          sessionId,
          conversationId: 'system-status',
          workingDirectory: session.workingDirectory,
          allowedPaths: [session.workingDirectory],
          metadata: {},
        });
        sendToConnection(ws, {
          type: 'system_status',
          ...(result.success ? { status: result.data } : { error: result.error }),
        });
        return;
      }

      case 'agent_start': {
        const request = AgentRunInputSchema.safeParse(message);
        if (!request.success) {
          sendToConnection(ws, { type: 'error', error: 'Invalid agent start request.' });
          return;
        }
        try {
          const runId = await agentRuntime.start(request.data);
          sendToConnection(ws, { type: 'agent_started', runId });
        } catch (error) {
          sendToConnection(ws, { type: 'error', error: error instanceof Error ? error.message : 'Failed to start agent run' });
        }
        return;
      }

      case 'agent_cancel': {
        const request = AgentCancelSchema.safeParse(message);
        if (!request.success) {
          sendToConnection(ws, { type: 'error', error: 'Invalid agent cancel request.' });
          return;
        }
        await agentRuntime.cancel(request.data.runId as any, request.data.reason);
        sendToConnection(ws, { type: 'agent_cancelled', runId: request.data.runId });
        return;
      }

      case 'agent_status': {
        const request = AgentStatusSchema.safeParse(message);
        if (!request.success) {
          sendToConnection(ws, { type: 'error', error: 'Invalid agent status request.' });
          return;
        }
        const run = await agentRuntime.getRun(request.data.runId as any);
        if (run) {
          sendToConnection(ws, { type: 'agent_status', run });
        } else {
          sendToConnection(ws, { type: 'error', error: 'Run not found' });
        }
        return;
      }

      case 'agent_resume': {
        const request = AgentResumeSchema.safeParse(message);
        if (!request.success) {
          sendToConnection(ws, { type: 'error', error: 'Invalid agent resume request.' });
          return;
        }
        try {
          await agentRuntime.resume(request.data.runId as any);
          sendToConnection(ws, { type: 'agent_resumed', runId: request.data.runId });
        } catch (error) {
          sendToConnection(ws, { type: 'error', error: error instanceof Error ? error.message : 'Failed to resume agent run' });
        }
        return;
      }

      default:
        sendToConnection(ws, { type: 'error', error: 'Unsupported WebSocket message type.' });
    }
  } catch (error) {
    console.error('WebSocket message failed:', error);
    sendToConnection(ws, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown server error.',
    });
  }
}

function getOrCreateConversation(
  sessionId: string,
  requestedId: string | undefined,
  firstMessage: string
): Conversation {
  if (requestedId) {
    const existing = stmt.getConversation.get(requestedId) as any;
    if (existing) {
      if (existing.session_id !== sessionId) throw new Error('Conversation not found.');
      return rowToConversation(existing);
    }
  }

  const conversation: Conversation = {
    id: requestedId || generateId(),
    sessionId,
    title: firstMessage.slice(0, 50) || 'New conversation',
    createdAt: new Date(),
    updatedAt: new Date(),
    messageCount: 0,
    metadata: {},
  };
  stmt.createConversation.run(
    conversation.id,
    conversation.sessionId,
    conversation.title,
    conversation.createdAt.getTime(),
    conversation.updatedAt.getTime(),
    conversation.messageCount,
    JSON.stringify(conversation.metadata)
  );
  return conversation;
}

function rememberCompletedRequest(requestKey: string): void {
  completedRequests.add(requestKey);
  if (completedRequests.size > 1000) {
    const oldest = completedRequests.values().next().value as string | undefined;
    if (oldest) completedRequests.delete(oldest);
  }
}

function sendToConnection(ws: WebSocket, message: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

async function initialize(): Promise<void> {
  await loadBuiltinSkills();
  
  server.listen(PORT, () => {
    console.log(`ORION server running on http://localhost:${PORT}`);
    console.log(`WebSocket available at ws://localhost:${PORT}${WS_PATH}`);
  });
}

initialize().catch((err) => {
  console.error('Failed to initialize server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  wss.close();
  server.close();
  process.exit(0);
});

import { systemTools } from '../tools/system/index.js';