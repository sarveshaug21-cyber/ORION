/**
 * ORION Core Types
 * Central type definitions for the ORION AI assistant
 */

// ============================================
// LLM Provider Types
// ============================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
  name?: string;
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolSchema;
  };
}

export interface LLMCompletionOptions {
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  model?: string;
  signal?: AbortSignal;
}

export interface LLMCompletionChunk {
  id: string;
  choices: Array<{
    delta: {
      content?: string;
      toolCalls?: LLMToolCallDelta[];
      role?: string;
    };
    index: number;
    finishReason: string | null;
  }>;
}

export interface LLMToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface LLMCompletion {
  id: string;
  choices: Array<{
    message: LLMMessage;
    index: number;
    finishReason: string;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  organizationId?: string;
  defaultHeaders?: Record<string, string>;
}

export interface LLMProvider {
  readonly name: string;
  readonly config: LLMProviderConfig;
  complete(options: LLMCompletionOptions): Promise<LLMCompletion>;
  streamComplete(options: LLMCompletionOptions): AsyncIterable<LLMCompletionChunk>;
  listModels(): Promise<string[]>;
}

export type ModelRole = 'primary' | 'fallback' | 'task-specific';

export interface ModelConfig {
  provider: string;
  model: string;
  role: ModelRole;
  tasks?: string[];
  enabled: boolean;
}

// ============================================
// Tool System Types
// ============================================

export type PermissionLevel = 'READ_ONLY' | 'SAFE_ACTION' | 'REQUIRES_CONFIRMATION';

export interface ToolSchema {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required?: string[];
  additionalProperties?: boolean | ToolProperty;
}

export interface ToolProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  items?: ToolProperty;
  properties?: Record<string, ToolProperty>;
  required?: string[];
  default?: unknown;
  additionalProperties?: boolean | ToolProperty;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolSchema;
  permissionLevel: PermissionLevel;
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>;
}

export interface ToolExecutionContext {
  userId: string;
  sessionId: string;
  conversationId: string;
  workingDirectory: string;
  allowedPaths: string[];
  metadata: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'awaiting_permission';
  result?: ToolResult;
  startedAt: Date;
  completedAt?: Date;
  permissionRequested?: boolean;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  unregister(name: string): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  getByPermissionLevel(level: PermissionLevel): ToolDefinition[];
  validateArguments(name: string, args: Record<string, unknown>): { valid: boolean; errors: string[] };
  execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    toolCallId?: string
  ): Promise<ToolResult>;
}

export * from './tool-events.js';

// ============================================
// Memory System Types
// ============================================

export type MemoryCategory = 'fact' | 'preference' | 'context' | 'procedure' | 'project' | 'contact' | 'custom';

export type MemorySource = 'conversation' | 'explicit' | 'tool_result' | 'observation' | 'import';

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  importance: number; // 0-100
  createdAt: Date;
  updatedAt: Date;
  source: MemorySource;
  metadata: Record<string, unknown>;
  tags: string[];
  conversationId?: string;
  embedding?: number[];
}

export type MemoryType = 'SHORT_TERM' | 'LONG_TERM' | 'CONVERSATION_HISTORY';

export interface MemoryStore {
  // Short-term memory (current session context)
  addShortTerm(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory>;
  getShortTerm(limit?: number): Promise<Memory[]>;
  clearShortTerm(): Promise<void>;

  // Long-term memory (persistent)
  addLongTerm(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory>;
  getLongTerm(options?: MemoryQueryOptions): Promise<Memory[]>;
  updateLongTerm(id: string, updates: Partial<Memory>): Promise<Memory | null>;
  deleteLongTerm(id: string): Promise<boolean>;
  searchLongTerm(query: string, limit?: number): Promise<Memory[]>;

  // Conversation history
  addConversationMessage(message: ConversationMessage): Promise<void>;
  getConversationHistory(conversationId: string, limit?: number): Promise<ConversationMessage[]>;
  getRecentConversations(limit?: number): Promise<ConversationSummary[]>;
}

export interface MemoryQueryOptions {
  category?: MemoryCategory;
  minImportance?: number;
  tags?: string[];
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: Date;
  createdAt: Date;
}

// ============================================
// Skill System Types
// ============================================

export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  keywords: string[];
  minOrionVersion?: string;
  dependencies?: string[];
}

export interface SkillManifest {
  metadata: SkillMetadata;
  tools: string[]; // tool names this skill provides
  commands: string[]; // command names this skill handles
  configSchema?: ToolSchema; // configuration schema for the skill
  defaultConfig?: Record<string, unknown>;
}

export interface Skill {
  readonly manifest: SkillManifest;
  readonly tools: Map<string, ToolDefinition>;
  readonly commands: Map<string, SkillCommand>;
  initialize(config: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;
  getConfig(): Record<string, unknown>;
  updateConfig(config: Record<string, unknown>): Promise<void>;
}

export interface SkillCommand {
  name: string;
  description: string;
  usage: string;
  execute: (args: string[], context: SkillCommandContext) => Promise<SkillCommandResult>;
}

export interface SkillCommandContext {
  conversationId: string;
  sessionId: string;
  workingDirectory: string;
  config: Record<string, unknown>;
}

export interface SkillCommandResult {
  success: boolean;
  output?: string;
  data?: unknown;
  error?: string;
}

export interface SkillRegistry {
  register(skill: Skill): Promise<void>;
  unregister(name: string): Promise<void>;
  get(name: string): Skill | undefined;
  list(): Skill[];
  getByKeyword(keyword: string): Skill[];
  loadFromDirectory(path: string): Promise<void>;
}

// ============================================
// System Types
// ============================================

export interface SystemStatus {
  cpu: {
    usage: number;
    cores: number;
    model: string;
    temperature?: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  storage: Array<{
    mount: string;
    total: number;
    free: number;
    used: number;
    usagePercent: number;
    type: string;
  }>;
  network: Array<{
    interface: string;
    ip: string;
    mac: string;
    speed: number;
    bytesReceived: number;
    bytesSent: number;
  }>;
  os: {
    platform: string;
    distro: string;
    release: string;
    arch: string;
    hostname: string;
    uptime: number;
  };
  timestamp: Date;
}

export interface SystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  version: string;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
  homedir: string;
  tmpdir: string;
}

// ============================================
// Conversation & Session Types
// ============================================

export interface Session {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  workingDirectory: string;
  activeConversationId?: string;
  config: SessionConfig;
  metadata: Record<string, unknown>;
}

export interface SessionConfig {
  autoSaveMemory: boolean;
  maxShortTermMemory: number;
  defaultPermissionLevel: PermissionLevel;
  voiceEnabled: boolean;
  language: string;
  theme: 'dark' | 'light' | 'system';
}

export interface Conversation {
  id: string;
  sessionId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  metadata: Record<string, unknown>;
}

// ============================================
// AI State Types
// ============================================

export type AIState = 'IDLE' | 'LISTENING' | 'THINKING' | 'EXECUTING' | 'WAITING_FOR_PERMISSION' | 'COMPLETED' | 'ERROR';

export interface AIActivity {
  id: string;
  type: 'voice_input' | 'understanding' | 'tool_call' | 'tool_result' | 'thinking' | 'response' | 'error' | 'permission_request';
  timestamp: Date;
  message: string;
  data?: Record<string, unknown>;
  toolCall?: ToolCall;
  level: 'info' | 'success' | 'warning' | 'error';
}

export interface StreamingResponse {
  content: string;
  toolCalls: LLMToolCall[];
  isComplete: boolean;
  error?: string;
}

// ============================================
// Settings Types
// ============================================

export interface UserSettings {
  ai: AISettings;
  voice: VoiceSettings;
  memory: MemorySettings;
  permissions: PermissionSettings;
  appearance: AppearanceSettings;
  shortcuts: ShortcutSettings;
  advanced: AdvancedSettings;
}

export interface AISettings {
  providers: LLMProviderConfig[];
  activeProvider: string;
  modelRouting: ModelConfig[];
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

export interface VoiceSettings {
  enabled: boolean;
  speechToText: 'browser' | 'whisper' | 'custom';
  textToSpeech: 'browser' | 'elevenlabs' | 'custom';
  language: string;
  voiceId?: string;
  wakeWord?: string;
  autoListen: boolean;
}

export interface MemorySettings {
  shortTermLimit: number;
  longTermRetentionDays: number;
  autoSaveFromConversation: boolean;
  importanceThreshold: number;
  enableEmbeddings: boolean;
}

export interface PermissionSettings {
  defaultLevel: PermissionLevel;
  allowedPaths: string[];
  blockedPaths: string[];
  requireConfirmationFor: PermissionLevel[];
  trustedTools: string[];
}

export interface AppearanceSettings {
  theme: 'dark' | 'light' | 'system';
  accentColor: string;
  fontSize: number;
  compactMode: boolean;
  animationsEnabled: boolean;
  glassmorphism: boolean;
}

export interface ShortcutSettings {
  commandPalette: string;
  newConversation: string;
  toggleVoice: string;
  toggleSettings: string;
  focusInput: string;
  cancelGeneration: string;
}

export interface AdvancedSettings {
  debugMode: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  telemetryEnabled: boolean;
  experimentalFeatures: string[];
  customCSS?: string;
}

// ============================================
// Error Types
// ============================================

export interface OrionError extends Error {
  code: string;
  userMessage: string;
  recoverable: boolean;
  suggestions?: string[];
  context?: Record<string, unknown>;
}

export function createOrionError(
  code: string,
  message: string,
  userMessage: string,
  options: {
    recoverable?: boolean;
    suggestions?: string[];
    context?: Record<string, unknown>;
  } = {}
): OrionError {
  const error = new Error(message) as OrionError;
  error.code = code;
  error.userMessage = userMessage;
  error.recoverable = options.recoverable ?? true;
  error.suggestions = options.suggestions;
  error.context = options.context;
  return error;
}

// ============================================
// Event Types
// ============================================

export interface OrionEvents {
  'session:created': Session;
  'session:updated': Session;
  'conversation:created': Conversation;
  'conversation:updated': Conversation;
  'conversation:deleted': string;
  'message:added': ConversationMessage;
  'message:updated': ConversationMessage;
  'tool:called': ToolCall;
  'tool:completed': ToolCall;
  'tool:failed': ToolCall;
  'permission:requested': ToolCall;
  'permission:granted': ToolCall;
  'permission:denied': ToolCall;
  'memory:added': Memory;
  'memory:updated': Memory;
  'memory:deleted': string;
  'skill:loaded': SkillMetadata;
  'skill:unloaded': string;
  'state:changed': AIState;
  'activity:added': AIActivity;
  'error': OrionError;
  'settings:updated': UserSettings;
}