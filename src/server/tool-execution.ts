import type {
  PermissionLevel,
  ToolExecutionContext,
  ToolResult,
  ToolRegistry,
} from '../types/index.js';
import {
  redactToolEventValue,
  safeToolEventText,
  ToolExecutionEventSchema,
  type ToolExecutionEvent,
} from '../types/tool-events.js';
import type { PermissionDecision } from './tool-permissions.js';

type ToolRegistryPort = Pick<ToolRegistry, 'get' | 'validateArguments' | 'execute'>;
const MAX_TOOL_EXECUTION_MS = 120_000;

export interface ToolExecutionRequest {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  conversationId: string;
  context: ToolExecutionContext;
  requireConfirmationFor: PermissionLevel[];
  invalidArguments?: string;
  blockedReason?: string;
}

export interface ToolExecutionDependencies {
  registry: ToolRegistryPort;
  emit: (event: ToolExecutionEvent) => void;
  requestPermission: (request: ToolExecutionRequest) => Promise<PermissionDecision>;
  onEvent?: (event: ToolExecutionEvent) => void;
  executionTimeoutMs?: number;
}

function actionFor(toolName: string, args: Record<string, unknown>): string {
  const commandParts = redactToolEventValue([
    args.command,
    ...(Array.isArray(args.args) ? args.args : []),
  ]) as unknown[];
  const arg =
    (typeof args.command === 'string' &&
      `Run command: ${commandParts
        .filter((part): part is string => typeof part === 'string')
        .map((part) => JSON.stringify(part))
        .join(' ')}`) ||
    (typeof args.path === 'string' && `Use path: ${args.path}`) ||
    (typeof args.from === 'string' &&
      typeof args.to === 'string' &&
      `Move ${args.from} to ${args.to}`) ||
    (typeof args.url === 'string' && `Open ${args.url}`) ||
    (typeof args.query === 'string' && `Search: ${args.query}`);
  return safeToolEventText(arg || toolName)?.slice(0, 1000) || toolName;
}

export class ToolExecutionPipeline {
  constructor(private readonly dependencies: ToolExecutionDependencies) {}

  async execute(request: ToolExecutionRequest): Promise<ToolResult> {
    const safeArguments = redactToolEventValue(request.arguments) as Record<string, unknown>;
    const action = actionFor(request.toolName, request.arguments);
    this.emit({
      type: 'TOOL_REQUESTED',
      status: 'pending',
      id: request.id,
      toolName: request.toolName,
      conversationId: request.conversationId,
      timestamp: new Date().toISOString(),
      action,
      arguments: safeArguments,
    });

    if (request.blockedReason) {
      return this.fail(request, action, safeArguments, request.blockedReason);
    }

    if (request.invalidArguments) {
      return this.fail(
        request,
        action,
        safeArguments,
        `Invalid tool arguments: ${request.invalidArguments}`
      );
    }

    const tool = this.dependencies.registry.get(request.toolName);
    if (!tool) {
      return this.fail(request, action, safeArguments, `Tool "${request.toolName}" is not available.`);
    }

    const validation = this.dependencies.registry.validateArguments(
      request.toolName,
      request.arguments
    );
    if (!validation.valid) {
      return this.fail(
        request,
        action,
        safeArguments,
        `Invalid arguments: ${validation.errors.join(', ')}`
      );
    }

    const requiresPermission =
      tool.permissionLevel === 'REQUIRES_CONFIRMATION' ||
      request.requireConfirmationFor.includes(tool.permissionLevel);

    if (requiresPermission) {
      this.emit({
        type: 'TOOL_PERMISSION_REQUIRED',
        status: 'awaiting_permission',
        id: request.id,
        toolName: request.toolName,
        conversationId: request.conversationId,
        timestamp: new Date().toISOString(),
        action,
        arguments: safeArguments,
      });
      const decision = await this.dependencies.requestPermission(request);
      if (decision !== 'approved') {
        const error =
          decision === 'expired'
            ? 'Permission request expired before approval.'
            : decision === 'disconnected'
              ? 'Permission request was cancelled because the requesting connection closed.'
              : 'Permission denied by user.';
        this.emit({
          type: 'TOOL_PERMISSION_DENIED',
          status: 'denied',
          id: request.id,
          toolName: request.toolName,
          conversationId: request.conversationId,
          timestamp: new Date().toISOString(),
          action,
          arguments: safeArguments,
          error,
        });
        this.emit({
          type: 'TOOL_COMPLETED',
          status: 'denied',
          id: request.id,
          toolName: request.toolName,
          conversationId: request.conversationId,
          timestamp: new Date().toISOString(),
          action,
          error,
        });
        return { success: false, error };
      }

      this.emit({
        type: 'TOOL_PERMISSION_APPROVED',
        status: 'approved',
        id: request.id,
        toolName: request.toolName,
        conversationId: request.conversationId,
        timestamp: new Date().toISOString(),
        action,
        arguments: safeArguments,
      });
    }

    this.emit({
      type: 'TOOL_STARTED',
      status: 'executing',
      id: request.id,
      toolName: request.toolName,
      conversationId: request.conversationId,
      timestamp: new Date().toISOString(),
      action,
      arguments: safeArguments,
    });

    let result: ToolResult;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeoutMs = Math.min(
      this.dependencies.executionTimeoutMs ?? MAX_TOOL_EXECUTION_MS,
      MAX_TOOL_EXECUTION_MS
    );
    try {
      const execution = this.dependencies.registry.execute(
        request.toolName,
        request.arguments,
        { ...request.context, signal: controller.signal },
        request.id
      );
      result = await Promise.race([
        execution,
        new Promise<ToolResult>((resolve) => {
          timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
            resolve({
              success: false,
              error: `Tool execution timed out after ${timeoutMs}ms.`,
            });
          }, timeoutMs);
        }),
      ]);
      if (timedOut) {
        result = {
          success: false,
          error: `Tool execution timed out after ${timeoutMs}ms.`,
        };
      }
    } catch (error) {
      result = timedOut
        ? {
            success: false,
            error: `Tool execution timed out after ${timeoutMs}ms.`,
          }
        : {
            success: false,
            error: error instanceof Error ? error.message : 'Tool execution failed.',
          };
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const safeResult = redactToolEventValue({
      success: result.success,
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.error ? { error: result.error } : {}),
    }) as ToolResult;
    const timestamp = new Date().toISOString();
    this.emit({
      type: 'TOOL_RESULT',
      status: result.success ? 'completed' : 'failed',
      id: request.id,
      toolName: request.toolName,
      conversationId: request.conversationId,
      timestamp,
      action,
      result: safeResult,
    });

    if (!result.success) {
      this.emit({
        type: 'TOOL_ERROR',
        status: 'failed',
        id: request.id,
        toolName: request.toolName,
        conversationId: request.conversationId,
        timestamp: new Date().toISOString(),
        action,
        error: safeToolEventText(result.error) || 'Tool execution failed.',
      });
    }

    this.emit({
      type: 'TOOL_COMPLETED',
      status: result.success ? 'completed' : 'failed',
      id: request.id,
      toolName: request.toolName,
      conversationId: request.conversationId,
      timestamp: new Date().toISOString(),
      action,
      ...(result.success ? {} : { error: safeToolEventText(result.error) || 'Tool execution failed.' }),
    });
    return result;
  }

  private fail(
    request: ToolExecutionRequest,
    action: string,
    safeArguments: Record<string, unknown>,
    error: string
  ): ToolResult {
    const safeError = safeToolEventText(error) || 'Tool execution failed.';
    const timestamp = new Date().toISOString();
    this.emit({
      type: 'TOOL_ERROR',
      status: 'failed',
      id: request.id,
      toolName: request.toolName,
      conversationId: request.conversationId,
      timestamp,
      action,
      arguments: safeArguments,
      error: safeError,
    });
    this.emit({
      type: 'TOOL_COMPLETED',
      status: 'failed',
      id: request.id,
      toolName: request.toolName,
      conversationId: request.conversationId,
      timestamp: new Date().toISOString(),
      action,
      error: safeError,
    });
    return { success: false, error: safeError };
  }

  private emit(event: ToolExecutionEvent): void {
    const validated = ToolExecutionEventSchema.parse(event);
    this.dependencies.onEvent?.(validated);
    this.dependencies.emit(validated);
  }
}
