import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolExecutionContext, ToolResult } from '../types/index.js';
import { ToolExecutionPipeline } from './tool-execution.js';
import type { PermissionDecision } from './tool-permissions.js';

const context: ToolExecutionContext = {
  userId: 'user',
  sessionId: 'session',
  conversationId: 'conversation',
  workingDirectory: '/tmp/orion',
  allowedPaths: ['/tmp/orion'],
  metadata: {},
};

function makeTool(permissionLevel: ToolDefinition['permissionLevel'], execute: ToolDefinition['execute']): ToolDefinition {
  return {
    name: 'test.run',
    description: 'Tool used by execution pipeline tests',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    permissionLevel,
    execute,
  };
}

function makePipeline(
  tool: ToolDefinition,
  decision: PermissionDecision = 'approved',
  executionTimeoutMs?: number
) {
  const events: Array<Record<string, unknown>> = [];
  const registry = {
    get: vi.fn(() => tool),
    validateArguments: vi.fn(() => ({ valid: true, errors: [] as string[] })),
    execute: vi.fn((_name, args, executionContext) =>
      tool.execute(args, executionContext)
    ),
  };
  const pipeline = new ToolExecutionPipeline({
    registry,
    emit: (event) => events.push(event),
    requestPermission: vi.fn(async () => decision),
    executionTimeoutMs,
  });
  return { pipeline, registry, events };
}

const request = {
  id: 'tool-call-1',
  toolName: 'test.run',
  arguments: {},
  conversationId: 'conversation',
  context,
  requireConfirmationFor: [] as ToolDefinition['permissionLevel'][],
};

describe('ToolExecutionPipeline', () => {
  it('waits for approval and emits lifecycle events around execution', async () => {
    const { pipeline, events, registry } = makePipeline(
      makeTool('REQUIRES_CONFIRMATION', async () => ({ success: true, data: { ok: true } }))
    );

    await expect(pipeline.execute(request)).resolves.toEqual({
      success: true,
      data: { ok: true },
    });
    expect(registry.execute).toHaveBeenCalledOnce();
    expect(events.map((event) => event.type)).toEqual([
      'TOOL_REQUESTED',
      'TOOL_PERMISSION_REQUIRED',
      'TOOL_PERMISSION_APPROVED',
      'TOOL_STARTED',
      'TOOL_RESULT',
      'TOOL_COMPLETED',
    ]);
  });

  it('does not execute when permission is denied', async () => {
    const { pipeline, events, registry } = makePipeline(
      makeTool('REQUIRES_CONFIRMATION', async () => ({ success: true })),
      'denied'
    );

    await expect(pipeline.execute(request)).resolves.toMatchObject({ success: false });
    expect(registry.execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toContain('TOOL_PERMISSION_DENIED');
    expect(events.at(-1)).toMatchObject({ type: 'TOOL_COMPLETED', status: 'denied' });
  });

  it('reports execution failures as structured lifecycle events', async () => {
    const { pipeline, events } = makePipeline(
      makeTool('READ_ONLY', async (): Promise<ToolResult> => {
        throw new Error('tool exploded');
      })
    );

    await expect(pipeline.execute(request)).resolves.toMatchObject({
      success: false,
      error: 'tool exploded',
    });
    expect(events.map((event) => event.type)).toContain('TOOL_ERROR');
    expect(events.at(-1)).toMatchObject({ type: 'TOOL_COMPLETED', status: 'failed' });
  });

  it('blocks invalid arguments before execution and redacts secrets from events', async () => {
    const { pipeline, events, registry } = makePipeline(
      makeTool('READ_ONLY', async () => ({ success: true }))
    );
    registry.validateArguments.mockReturnValue({
      valid: false,
      errors: ['unexpected property'],
    });

    await expect(
      pipeline.execute({
        ...request,
        arguments: {
          command: 'git',
          apiKey: 'private-value',
          args: ['--password', 'private-password'],
          url: 'https://user:pass@example.test/?token=private-token',
        },
      })
    ).resolves.toMatchObject({ success: false });
    expect(registry.execute).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({
      type: 'TOOL_REQUESTED',
      arguments: {
        command: 'git',
        apiKey: '[redacted]',
        args: ['--password', '[redacted]'],
        url: 'https://[redacted]@example.test/?token=[redacted]',
      },
    });
    expect(events[0].action).not.toContain('private-password');
  });

  it('aborts and completes tools that exceed the execution timeout', async () => {
    let receivedSignal: AbortSignal | undefined;
    const { pipeline, events } = makePipeline(
      makeTool(
        'READ_ONLY',
        (_args, executionContext) =>
          new Promise<ToolResult>((_resolve, reject) => {
            receivedSignal = executionContext.signal;
            executionContext.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          })
      ),
      'approved',
      5
    );

    await expect(pipeline.execute(request)).resolves.toMatchObject({
      success: false,
      error: 'Tool execution timed out after 5ms.',
    });
    expect(receivedSignal?.aborted).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'TOOL_COMPLETED', status: 'failed' });
  });
});
