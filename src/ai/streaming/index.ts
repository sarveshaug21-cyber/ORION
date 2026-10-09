/**
 * ORION Streaming Utilities
 * Handles streaming response processing and tool call accumulation
 */

import type { LLMCompletionChunk, LLMToolCall, LLMMessage, LLMToolCallDelta } from '../../types/index.js';

export interface StreamingState {
  content: string;
  toolCalls: Map<number, AccumulatedToolCall>;
  isComplete: boolean;
  finishReason: string | null;
  error?: string;
}

interface AccumulatedToolCall {
  id?: string;
  type?: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export function createStreamingState(): StreamingState {
  return {
    content: '',
    toolCalls: new Map(),
    isComplete: false,
    finishReason: null,
  };
}

export function processChunk(state: StreamingState, chunk: LLMCompletionChunk): StreamingState {
  const choice = chunk.choices[0];
  if (!choice) return state;

  const newState = { ...state };

  if (choice.delta.content) {
    newState.content += choice.delta.content;
  }

  if (choice.delta.toolCalls) {
    for (const tc of choice.delta.toolCalls) {
      processToolCallDelta(newState.toolCalls, tc);
    }
  }

  if (choice.finishReason) {
    newState.isComplete = true;
    newState.finishReason = choice.finishReason;
  }

  return newState;
}

export function finalizeStreamingState(state: StreamingState): {
  content: string;
  toolCalls: LLMToolCall[];
} {
  const toolCalls: LLMToolCall[] = [];

  const orderedCalls = [...state.toolCalls.entries()].sort(([left], [right]) => left - right);
  for (const [, tc] of orderedCalls) {
    if (tc.id && tc.function?.name) {
      toolCalls.push({
        id: tc.id!,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments || '{}',
        },
      });
    }
  }

  return {
    content: state.content,
    toolCalls,
  };
}

export function processToolCallDelta(
  calls: Map<number, AccumulatedToolCall>,
  delta: LLMToolCallDelta
): void {
  const existing = calls.get(delta.index) || {
    id: delta.id,
    type: 'function' as const,
    function: { name: '', arguments: '' },
  };
  if (delta.id) existing.id = delta.id;
  if (delta.function?.name) {
    existing.function = {
      ...existing.function,
      name: `${existing.function?.name || ''}${delta.function.name}`,
    };
  }
  if (delta.function?.arguments) {
    existing.function = {
      ...existing.function,
      arguments: `${existing.function?.arguments || ''}${delta.function.arguments}`,
    };
  }
  calls.set(delta.index, existing);
}

export function createAssistantMessage(
  content: string,
  toolCalls: LLMToolCall[] = []
): LLMMessage {
  return {
    role: 'assistant',
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

export function createToolMessage(
  toolCallId: string,
  content: string
): LLMMessage {
  return {
    role: 'tool',
    content,
    toolCallId,
  };
}

export async function* simulateStreaming(
  text: string,
  chunkSize: number = 10,
  delay: number = 30
): AsyncIterable<LLMCompletionChunk> {
  const id = `sim-${Date.now()}`;
  let index = 0;

  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    yield {
      id,
      choices: [
        {
          delta: { content: chunk },
          index: 0,
          finishReason: null,
        },
      ],
    };
    await new Promise((resolve) => setTimeout(resolve, delay));
    index++;
  }

  yield {
    id,
    choices: [
      {
        delta: {},
        index: 0,
        finishReason: 'stop',
      },
    ],
  };
}

export class StreamAccumulator {
  private state = createStreamingState();
  private onUpdate?: (state: StreamingState) => void;
  private abortSignal?: AbortSignal;
  private aborted = false;

  constructor(onUpdate?: (state: StreamingState) => void, abortSignal?: AbortSignal) {
    this.onUpdate = onUpdate;
    this.abortSignal = abortSignal;
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        this.aborted = true;
      });
    }
  }

  process(chunk: LLMCompletionChunk): void {
    if (this.aborted || this.abortSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    this.state = processChunk(this.state, chunk);
    this.onUpdate?.(this.state);
  }

  getState(): StreamingState {
    return { ...this.state };
  }

  getContent(): string {
    return this.state.content;
  }

  getToolCalls(): LLMToolCall[] {
    return finalizeStreamingState(this.state).toolCalls;
  }

  isComplete(): boolean {
    return this.state.isComplete;
  }

  isAborted(): boolean {
    return this.aborted;
  }

  reset(): void {
    this.state = createStreamingState();
    this.aborted = false;
  }
}

export function parseToolArguments(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

export function formatToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return 'null';
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}