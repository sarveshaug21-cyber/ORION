import { z } from 'zod';

const eventBase = {
  id: z.string().min(1),
  toolName: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  timestamp: z.string().datetime(),
  action: z.string().max(1000).optional(),
  arguments: z.record(z.unknown()).optional(),
  result: z
    .object({
      success: z.boolean(),
      data: z.unknown().optional(),
      error: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(),
};

export const ToolExecutionEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('TOOL_REQUESTED'), status: z.literal('pending') }),
  z.object({
    ...eventBase,
    type: z.literal('TOOL_PERMISSION_REQUIRED'),
    status: z.literal('awaiting_permission'),
  }),
  z.object({
    ...eventBase,
    type: z.literal('TOOL_PERMISSION_APPROVED'),
    status: z.literal('approved'),
  }),
  z.object({
    ...eventBase,
    type: z.literal('TOOL_PERMISSION_DENIED'),
    status: z.literal('denied'),
    error: z.string(),
  }),
  z.object({ ...eventBase, type: z.literal('TOOL_STARTED'), status: z.literal('executing') }),
  z.object({
    ...eventBase,
    type: z.literal('TOOL_RESULT'),
    status: z.enum(['completed', 'failed']),
    result: eventBase.result.unwrap(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('TOOL_ERROR'),
    status: z.literal('failed'),
    error: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('TOOL_COMPLETED'),
    status: z.enum(['completed', 'failed', 'denied']),
    error: z.string().optional(),
  }),
]);

export type ToolExecutionEvent = z.infer<typeof ToolExecutionEventSchema>;

export const PermissionResponseSchema = z.object({
  type: z.literal('permission_response'),
  toolCallId: z.string().min(1).max(200),
  granted: z.boolean(),
});

export const ChatRequestSchema = z.object({
  type: z.literal('chat'),
  requestId: z.string().min(1).max(200).optional(),
  conversationId: z.string().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(32_000),
});

export function redactToolEventValue(value: unknown, key = ''): unknown {
  const sensitiveKey =
    /(?:api.?key|access.?token|secret|password|authorization|cookie|credential|private.?key)/i;
  if (
    sensitiveKey.test(key) ||
    /^env$/i.test(key)
  ) {
    return '[redacted]';
  }

  if (typeof value === 'string') {
    return value
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[redacted token]')
      .replace(/\b(api[_-]?key|access[_-]?token|client[_-]?secret|password|authorization)\s*[:=]\s*(['"]?)[^\s,'"}]+\2/gi, '$1=[redacted]')
      .replace(/([?&]token=)[^&\s]*/gi, '$1[redacted]')
      .replace(/:\/\/[^/\s:@]+:[^@/\s]+@/g, '://[redacted]@')
      .slice(0, 4000);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item, index) => {
      const previous = value[index - 1];
      if (
        typeof previous === 'string' &&
        sensitiveKey.test(previous.replace(/^-+/, '').split('=', 1)[0])
      ) {
        return '[redacted]';
      }
      return redactToolEventValue(item);
    });
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([childKey, childValue]) => [childKey, redactToolEventValue(childValue, childKey)])
    );
  }

  return value;
}

export function safeToolEventText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return typeof text === 'string' ? (redactToolEventValue(text) as string) : undefined;
}
