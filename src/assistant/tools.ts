/**
 * ORION Assistant Tools
 * File, Obsidian, and Task operations for the assistant
 */

import type {
  AssistantAction,
  AssistantActionResult,
  AssistantContext,
} from '../types/assistant.js';
import type { ToolExecutionContext, ToolResult, ToolDefinition } from '../types/index.js';
import { toolRegistry } from '../tools/registry.js';
import { ToolExecutionPipeline } from '../server/tool-execution.js';
import { ToolPermissionManager } from '../server/tool-permissions.js';
import { StreamAccumulator, formatToolResult } from '../ai/streaming/index.js';
import { createAssistantError } from '../types/assistant.js';
import { generateId, now } from '../lib/utils.js';

/**
 * Execute file operation through existing tool registry
 */
export async function executeFileOperation(
  action: any,
  ctx: AssistantContext
): Promise<any> {
  const toolName = `filesystem.${action.operation}`;
  const tool = toolRegistry.get(toolName);
  
  if (!tool) {
    return { success: false, error: `File operation '${action.operation}' not available` };
  }

  // Use the permission manager from context
  const permissionManager = new ToolPermissionManager();
  
  const pipeline = new ToolExecutionPipeline({
    registry: {
      get: (name: string) => toolRegistry.get(name),
      validateArguments: (name: string, args: Record<string, unknown>) => toolRegistry.validateArguments(name, args),
      execute: (name: string, args: Record<string, unknown>, ctx: ToolExecutionContext, toolCallId?: string) =>
        toolRegistry.execute(name, args, ctx, toolCallId),
    },
    emit: () => {},
    requestPermission: async (request: any) => {
      // Use the permission manager to handle the request
      const owner = { assistantContext: true, sessionId: ctx.session.sessionId };
      return permissionManager.request(request.id, ctx.session.sessionId, owner);
    },
    executionTimeoutMs: 30000,
  });

  const args: Record<string, unknown> = { path: action.path };
  if (action.content !== undefined) args.content = action.content;
  if (action.recursive !== undefined) args.recursive = action.recursive;

  const toolCallId = `tc-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const execContext: ToolExecutionContext = {
    userId: ctx.session.userId,
    sessionId: ctx.session.sessionId,
    conversationId: ctx.conversation.id,
    workingDirectory: ctx.workingDirectory,
    allowedPaths: ctx.allowedPaths,
    metadata: {},
    signal: undefined,
  };

  const result = await pipeline.execute({
    id: `tc-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    toolName,
    arguments: args,
    conversationId: ctx.conversation.id,
    context: execContext,
    requireConfirmationFor: ['REQUIRES_CONFIRMATION'],
  });

  return { success: result.success, data: result.data, error: result.error };
}

/**
 * Execute Obsidian operation
 */
export async function executeObsidianOperation(
  action: any,
  ctx: AssistantContext
): Promise<any> {
  // Obsidian operations are implemented as filesystem operations on the vault path
  const vaultPath = (ctx.userSettings as any).assistant?.defaultVaultPath || ctx.workingDirectory;
  
  if (!vaultPath) {
    return { success: false, error: 'Obsidian vault not configured' };
  }

  let toolName: string;
  let args: Record<string, unknown> = {};

  switch (action.operation) {
    case 'search':
      toolName = 'filesystem.search';
      args = { path: vaultPath, pattern: action.query || '**/*.md', content: action.query };
      break;
    case 'read':
      toolName = 'filesystem.read';
      if (!action.noteId) return { success: false, error: 'Note ID required for read' };
      args = { path: action.noteId };
      break;
    case 'create':
      toolName = 'filesystem.write';
      if (!action.title) return { success: false, error: 'Title required for create' };
      args = { path: `${vaultPath}/${action.title}.md`, content: action.content || '' };
      break;
    case 'update':
      toolName = 'filesystem.write';
      if (!action.noteId) return { success: false, error: 'Note ID required for update' };
      args = { path: action.noteId, content: action.content };
      break;
    case 'list':
      toolName = 'filesystem.list';
      args = { path: vaultPath, pattern: '**/*.md', recursive: true };
      break;
    default:
      return { success: false, error: `Unknown Obsidian operation: ${action.operation}` };
  }

  const tool = toolRegistry.get(toolName);
  if (!tool) {
    return { success: false, error: `Tool ${toolName} not available` };
  }

  const toolCallId = `tc-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const permissionManager = new ToolPermissionManager();
  
  const pipeline = new ToolExecutionPipeline({
    registry: {
      get: (name: string) => toolRegistry.get(name),
      validateArguments: (name: string, args: Record<string, unknown>) => toolRegistry.validateArguments(name, args),
      execute: (name: string, args: Record<string, unknown>, ctx: ToolExecutionContext) =>
        toolRegistry.execute(name, args, ctx),
    },
    emit: () => {},
    requestPermission: async (request: any) => {
      const owner = { assistantContext: true, sessionId: ctx.session.sessionId };
      return permissionManager.request(request.id, ctx.session.sessionId, owner);
    },
    executionTimeoutMs: 30000,
  });

  const execContext: ToolExecutionContext = {
    userId: 'user',
    sessionId: 'session',
    conversationId: 'conversation',
    workingDirectory: process.cwd(),
    allowedPaths: [process.cwd()],
    metadata: {},
    signal: undefined,
  };

  const result = await pipeline.execute({
    id: toolCallId,
    toolName,
    arguments: args,
    conversationId: 'obsidian',
    context: execContext,
    requireConfirmationFor: ['REQUIRES_CONFIRMATION'],
  });

  return { success: result.success, data: result.data, error: result.error };
}

/**
 * Execute task operation
 */
export async function executeTaskOperation(
  action: any,
  ctx: AssistantContext
): Promise<any> {
  // For now, return a placeholder - task operations would use the database
  // In a full implementation, this would interact with a task database
  
  switch (action.operation) {
    case 'create':
      return { success: true, data: { id: `task-${Date.now()}`, ...action, status: 'pending', createdAt: new Date() } };
    case 'list':
      return { success: true, data: [] };
    case 'complete':
      if (!action.taskId) return { success: false, error: 'Task ID required' };
      return { success: true, data: { id: action.taskId, status: 'completed' } };
    case 'update':
      if (!action.taskId) return { success: false, error: 'Task ID required' };
      return { success: true, data: { id: action.taskId, ...action } };
    default:
      return { success: false, error: `Unknown task operation: ${action.operation}` };
  }
}