import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebSocketProvider, useWebSocket } from './components/WebSocketProvider';
import { MainLayout } from './components/MainLayout';
import { SettingsModal } from './components/SettingsModal';
import { CommandPalette } from './components/CommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { generateId } from './lib/utils';
import type {
  AIState,
  Conversation,
  ConversationMessage,
  Session,
  SystemStatus,
  ToolCall,
  ToolExecutionEvent,
  UserSettings,
} from './types';
import type { DisplayMessage } from './components/MessageList';
import { ToolExecutionEventSchema } from './types/tool-events';

const defaultSettings: UserSettings = {
  ai: {
    providers: [],
    activeProvider: '',
    modelRouting: [],
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: '',
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
    allowedPaths: [],
    blockedPaths: [],
    requireConfirmationFor: ['REQUIRES_CONFIRMATION'],
    trustedTools: [],
  },
  appearance: {
    theme: 'dark',
    accentColor: '#06b6d4',
    fontSize: 14,
    compactMode: false,
    animationsEnabled: true,
    glassmorphism: false,
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

interface PendingPermission {
  toolCall: ToolCall;
  title: string;
  message: string;
}

function AppShell() {
  const { sendMessage, lastMessage, readyState } = useWebSocket();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const completedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesByConversation = useRef<Map<string, DisplayMessage[]>>(new Map());
  const activeConversationIdRef = useRef<string | null>(null);
  const streamingContentRef = useRef('');
  const cancelledRef = useRef(false);

  const [session, setSession] = useState<Session | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [aiState, setAIState] = useState<AIState>('IDLE');
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [systemStatusLoading, setSystemStatusLoading] = useState(false);
  const [systemStatusError, setSystemStatusError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    streamingContentRef.current = streamingContent;
  }, [streamingContent]);

  const isConnected = readyState === WebSocket.OPEN;

  const providerName = settings.ai.activeProvider || settings.ai.providers[0]?.baseUrl || '';
  const modelName = settings.ai.providers[0]?.model || '';

  const persistMessages = useCallback((conversationId: string, next: DisplayMessage[]) => {
    messagesByConversation.current.set(conversationId, next);
    setMessages(next);
  }, []);

  const setTransientState = useCallback((state: AIState) => {
    if (completedTimer.current) {
      clearTimeout(completedTimer.current);
      completedTimer.current = null;
    }
    setAIState(state);
    if (state === 'COMPLETED') {
      completedTimer.current = setTimeout(() => setAIState('IDLE'), 1600);
    }
  }, []);

  useEffect(() => {
    if (readyState === WebSocket.OPEN) {
      sendMessage({ type: 'get_sessions' });
      sendMessage({ type: 'get_settings' });
      sendMessage({ type: 'get_conversations' });
      setSystemStatusLoading(true);
      sendMessage({ type: 'system_status' });
    }
  }, [readyState, sendMessage]);

  useEffect(() => {
    if (!isConnected) return;
    const id = setInterval(() => {
      sendMessage({ type: 'system_status' });
    }, 10000);
    return () => clearInterval(id);
  }, [isConnected, sendMessage]);

  useEffect(() => {
    document.documentElement.style.setProperty('--orion-accent', settings.appearance.accentColor);
    document.documentElement.classList.toggle('dark', settings.appearance.theme !== 'light');
    if (settings.appearance.theme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  }, [settings.appearance]);

  useEffect(() => {
    if (!lastMessage) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(lastMessage.data));
    } catch {
      console.error('Failed to parse WebSocket message');
      return;
    }

    const type = payload.type as string;

    switch (type) {
      case 'connected': {
        const sessionId = String(payload.sessionId || '');
        setSession((prev) =>
          prev
            ? { ...prev, id: sessionId || prev.id }
            : {
                id: sessionId,
                userId: 'default',
                createdAt: new Date(),
                updatedAt: new Date(),
                workingDirectory: '',
                config: {
                  autoSaveMemory: true,
                  maxShortTermMemory: 50,
                  defaultPermissionLevel: 'READ_ONLY',
                  voiceEnabled: false,
                  language: 'en-US',
                  theme: 'dark',
                },
                metadata: {},
              }
        );
        break;
      }

      case 'sessions': {
        const sessions = (payload.sessions as Session[]) || [];
        if (sessions[0]) setSession(sessions[0]);
        break;
      }

      case 'conversations': {
        const list = ((payload.conversations as Conversation[]) || []).map(normalizeConversation);
        setConversations(list);
        setActiveConversationId((current) => {
          if (current) return current;
          return list[0]?.id ?? null;
        });
        break;
      }

      case 'settings':
      case 'settings_updated': {
        if (payload.settings) {
          setSettings({ ...defaultSettings, ...(payload.settings as UserSettings) });
        }
        break;
      }

      case 'stream_chunk': {
        if (cancelledRef.current) break;
        const chunk = String(payload.content || '');
        setIsStreaming(true);
        setTransientState('THINKING');
        setStreamingContent((prev) => prev + chunk);
        break;
      }

      case 'complete': {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          setIsStreaming(false);
          setStreamingContent('');
          setTransientState('IDLE');
          break;
        }

        const message = payload.message as ConversationMessage | undefined;
        const conversationId =
          message?.conversationId || activeConversationIdRef.current || generateId();
        const streamed = streamingContentRef.current;

        if (message) {
          const normalized = normalizeMessage(message);
          const existing = messagesByConversation.current.get(conversationId) || [];
          const withoutDup = existing.filter((m) => m.id !== normalized.id);
          persistMessages(conversationId, [...withoutDup, normalized]);

          if (normalized.toolCalls?.length) {
            setToolCalls((prev) => {
              const mapped = normalized.toolCalls!.map((tc) => {
                const existingCall = prev.find((p) => p.id === tc.id);
                if (existingCall) {
                  const denied = existingCall.result?.error === 'Permission denied';
                  return {
                    ...existingCall,
                    toolName: tc.function.name,
                    arguments: safeParseArgs(tc.function.arguments),
                    status: denied ? ('failed' as const) : ('completed' as const),
                    completedAt: existingCall.completedAt || new Date(),
                  };
                }
                return {
                  id: tc.id,
                  toolName: tc.function.name,
                  arguments: safeParseArgs(tc.function.arguments),
                  status: 'completed' as const,
                  startedAt: new Date(),
                };
              });
              return [...mapped, ...prev.filter((p) => !mapped.some((m) => m.id === p.id))].slice(
                0,
                40
              );
            });
          }
        } else if (streamed) {
          const assistantMsg: DisplayMessage = {
            id: generateId(),
            conversationId,
            role: 'assistant',
            content: streamed,
            createdAt: new Date(),
          };
          const existing = messagesByConversation.current.get(conversationId) || [];
          persistMessages(conversationId, [...existing, assistantMsg]);
        }

        setIsStreaming(false);
        setStreamingContent('');
        setTransientState('COMPLETED');

        setConversations((prev) => {
          if (prev.some((c) => c.id === conversationId)) {
            return prev.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    updatedAt: new Date(),
                    messageCount: c.messageCount + 1,
                  }
                : c
            );
          }
          return prev;
        });
        break;
      }

      case 'permission_request': {
        const raw = payload.toolCall as {
          id: string;
          toolName: string;
          arguments?: Record<string, unknown>;
          action?: string;
        };
        const toolCall: ToolCall = {
          id: raw.id,
          toolName: raw.toolName,
          arguments: raw.arguments || {},
          status: 'awaiting_permission',
          startedAt: new Date(),
          permissionRequested: true,
        };
        setToolCalls((prev) => [toolCall, ...prev.filter((t) => t.id !== toolCall.id)]);
        setTransientState('WAITING_FOR_PERMISSION');
        setPendingPermission({
          toolCall,
          title: 'Confirm action',
          message:
            raw.action ||
            `ORION wants to run “${toolCall.toolName}”. This requires your permission.`,
        });
        break;
      }

      case 'tool_event': {
        const parsedEvent = ToolExecutionEventSchema.safeParse(payload.event);
        if (!parsedEvent.success) {
          console.error('Received an invalid ORION tool event.');
          break;
        }

        const event: ToolExecutionEvent = parsedEvent.data;
        setToolCalls((prev) => {
          const existing = prev.find((toolCall) => toolCall.id === event.id);
          const next: ToolCall = {
            id: event.id,
            toolName: event.toolName,
            arguments: event.arguments || existing?.arguments || {},
            status: existing?.status || 'pending',
            startedAt: existing?.startedAt || new Date(event.timestamp),
            permissionRequested: existing?.permissionRequested,
            result: existing?.result,
            completedAt: existing?.completedAt,
          };

          switch (event.type) {
            case 'TOOL_REQUESTED':
              next.status = 'pending';
              break;
            case 'TOOL_PERMISSION_REQUIRED':
              next.status = 'awaiting_permission';
              next.permissionRequested = true;
              break;
            case 'TOOL_PERMISSION_APPROVED':
              next.permissionRequested = true;
              break;
            case 'TOOL_STARTED':
              next.status = 'executing';
              next.startedAt = new Date(event.timestamp);
              break;
            case 'TOOL_RESULT':
              next.status = event.status === 'completed' ? 'completed' : 'failed';
              next.result = event.result;
              break;
            case 'TOOL_ERROR':
              next.status = 'failed';
              next.result = { success: false, error: event.error };
              break;
            case 'TOOL_PERMISSION_DENIED':
              next.status = 'failed';
              next.result = { success: false, error: event.error };
              next.completedAt = new Date(event.timestamp);
              break;
            case 'TOOL_COMPLETED':
              next.status = event.status === 'completed' ? 'completed' : 'failed';
              next.result =
                next.result ||
                (event.error ? { success: false, error: event.error } : undefined);
              next.completedAt = new Date(event.timestamp);
              break;
          }

          return [
            next,
            ...prev.filter((toolCall) => toolCall.id !== event.id),
          ].slice(0, 40);
        });
        break;
      }

      case 'system_status': {
        setSystemStatusLoading(false);
        if (payload.status) {
          setSystemStatus(normalizeSystemStatus(payload.status as SystemStatus));
          setSystemStatusError(null);
        } else {
          setSystemStatusError('System status unavailable');
        }
        break;
      }

      case 'error': {
        const err = String(payload.error || 'Unknown error');
        setInputError(err);
        setIsStreaming(false);
        setStreamingContent('');
        setTransientState('ERROR');
        break;
      }

      default:
        break;
    }
  }, [lastMessage, persistMessages, setTransientState]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    setMessages(messagesByConversation.current.get(activeConversationId) || []);
  }, [activeConversationId]);

  const sendChatMessage = useCallback(
    (content: string) => {
      if (!isConnected) {
        setInputError('ORION is offline. Waiting for connection…');
        return;
      }

      cancelledRef.current = false;
      setInputError(null);
      setStreamingContent('');
      setIsStreaming(false);
      setTransientState('THINKING');

      let conversationId = activeConversationId;
      if (!conversationId) {
        conversationId = generateId();
        const newConv: Conversation = {
          id: conversationId,
          sessionId: session?.id || '',
          title: content.slice(0, 48) || 'New conversation',
          createdAt: new Date(),
          updatedAt: new Date(),
          messageCount: 0,
          metadata: {},
        };
        setConversations((prev) => [newConv, ...prev]);
        setActiveConversationId(conversationId);
      } else {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  title: c.messageCount === 0 ? content.slice(0, 48) : c.title,
                  updatedAt: new Date(),
                  messageCount: c.messageCount + 1,
                }
              : c
          )
        );
      }

      const userMessage: DisplayMessage = {
        id: generateId(),
        conversationId,
        role: 'user',
        content,
        createdAt: new Date(),
      };
      const existing = messagesByConversation.current.get(conversationId) || [];
      persistMessages(conversationId, [...existing, userMessage]);

      sendMessage({
        type: 'chat',
        requestId: userMessage.id,
        conversationId,
        content,
      });
    },
    [
      isConnected,
      activeConversationId,
      session?.id,
      sendMessage,
      persistMessages,
      setTransientState,

    ]
  );

  const newConversation = useCallback(() => {
    const conversationId = generateId();
    const newConv: Conversation = {
      id: conversationId,
      sessionId: session?.id || '',
      title: 'New conversation',
      createdAt: new Date(),
      updatedAt: new Date(),
      messageCount: 0,
      metadata: {},
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(conversationId);
    messagesByConversation.current.set(conversationId, []);
    setMessages([]);
    setStreamingContent('');
    setIsStreaming(false);
    setTransientState('IDLE');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [session?.id, setTransientState]);

  const selectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    setStreamingContent('');
    setIsStreaming(false);
  }, []);

  const cancelGeneration = useCallback(() => {
    cancelledRef.current = true;
    setIsStreaming(false);
    setStreamingContent('');
    setTransientState('IDLE');
  }, [setTransientState]);

  const handleListeningChange = useCallback(
    (listening: boolean) => {
      if (listening) setTransientState('LISTENING');
      else
        setAIState((prev) => (prev === 'LISTENING' ? 'IDLE' : prev));
    },
    [setTransientState]
  );

  const toggleSettings = useCallback(() => setShowSettings((v) => !v), []);
  const toggleCommandPalette = useCallback(() => setShowCommandPalette((v) => !v), []);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);

  const toggleVoice = useCallback(() => {
    setSettings((prev) => {
      const next = {
        ...prev,
        voice: { ...prev.voice, enabled: !prev.voice.enabled },
      };
      sendMessage({ type: 'update_settings', settings: next });
      return next;
    });
  }, [sendMessage]);

  const handleSettingsChange = useCallback(
    (partial: Partial<UserSettings>) => {
      setSettings((prev) => {
        const next: UserSettings = {
          ...prev,
          ...partial,
          ai: partial.ai ? { ...prev.ai, ...partial.ai } : prev.ai,
          voice: partial.voice ? { ...prev.voice, ...partial.voice } : prev.voice,
          memory: partial.memory ? { ...prev.memory, ...partial.memory } : prev.memory,
          permissions: partial.permissions
            ? { ...prev.permissions, ...partial.permissions }
            : prev.permissions,
          appearance: partial.appearance
            ? { ...prev.appearance, ...partial.appearance }
            : prev.appearance,
          shortcuts: partial.shortcuts
            ? { ...prev.shortcuts, ...partial.shortcuts }
            : prev.shortcuts,
          advanced: partial.advanced ? { ...prev.advanced, ...partial.advanced } : prev.advanced,
        };
        sendMessage({ type: 'update_settings', settings: next });
        return next;
      });
    },
    [sendMessage]
  );

  const respondToPermission = useCallback(
    (granted: boolean) => {
      if (!pendingPermission) return;
      const { toolCall } = pendingPermission;
      sendMessage({
        type: 'permission_response',
        toolCallId: toolCall.id,
        granted,
      });
      setToolCalls((prev) =>
        prev.map((t) =>
          t.id === toolCall.id
            ? {
                ...t,
                status: granted ? 'executing' : 'failed',
                result: granted ? t.result : { success: false, error: 'Permission denied' },
                startedAt: granted ? new Date() : t.startedAt,
                completedAt: granted ? undefined : new Date(),
              }
            : t
        )
      );
      setTransientState(granted ? 'EXECUTING' : 'IDLE');
      setPendingPermission(null);
    },
    [pendingPermission, sendMessage, setTransientState]
  );

  const shortcutHandlers = useMemo(
    () => ({
      commandPalette: toggleCommandPalette,
      newConversation,
      toggleVoice,
      toggleSettings,
      focusInput,
      cancelGeneration,
    }),
    [
      toggleCommandPalette,
      newConversation,
      toggleVoice,
      toggleSettings,
      focusInput,
      cancelGeneration,
    ]
  );

  useKeyboardShortcuts(settings.shortcuts, shortcutHandlers);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-orion-bg text-orion-text">
      <MainLayout
        session={session}
        conversations={conversations}
        activeConversationId={activeConversationId}
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        settings={settings}
        aiState={aiState}
        toolCalls={toolCalls}
        systemStatus={systemStatus}
        systemStatusLoading={systemStatusLoading}
        systemStatusError={systemStatusError}
        isConnected={isConnected}
        isConnecting={readyState === WebSocket.CONNECTING}
        providerName={providerName}
        modelName={modelName}
        inputError={inputError}
        inputRef={inputRef}
        onSendMessage={sendChatMessage}
        onCancelGeneration={cancelGeneration}
        onClearInputError={() => setInputError(null)}
        onListeningChange={handleListeningChange}
        onNewConversation={newConversation}
        onConversationSelect={selectConversation}
        onToggleSettings={toggleSettings}
        onToggleCommandPalette={toggleCommandPalette}
      />

      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={toggleSettings}
          onChange={handleSettingsChange}
          providerName={providerName}
          modelName={modelName}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          onClose={toggleCommandPalette}
          conversations={conversations}
          activeConversationId={activeConversationId}
          onNewConversation={newConversation}
          onConversationSelect={selectConversation}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onOpenSettings={() => {
            setShowCommandPalette(false);
            setShowSettings(true);
          }}
          onFocusInput={focusInput}
          onToggleVoice={toggleVoice}
        />
      )}

      {pendingPermission && (
        <ConfirmDialog
          title={pendingPermission.title}
          message={pendingPermission.message}
          confirmLabel="Allow"
          cancelLabel="Deny"
          onConfirm={() => respondToPermission(true)}
          onCancel={() => respondToPermission(false)}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <WebSocketProvider>
      <AppShell />
    </WebSocketProvider>
  );
}

function normalizeConversation(conv: Conversation): Conversation {
  return {
    ...conv,
    createdAt: new Date(conv.createdAt),
    updatedAt: new Date(conv.updatedAt),
  };
}

function normalizeMessage(message: ConversationMessage): DisplayMessage {
  return {
    ...message,
    createdAt: new Date(message.createdAt),
  };
}

function normalizeSystemStatus(status: SystemStatus): SystemStatus {
  return {
    ...status,
    timestamp: new Date(status.timestamp as unknown as string),
  };
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}
