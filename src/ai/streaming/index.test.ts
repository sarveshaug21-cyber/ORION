import { describe, expect, it } from 'vitest';
import { finalizeStreamingState, processToolCallDelta } from './index.js';
import { createStreamingState } from './index.js';

describe('streamed tool-call accumulation', () => {
  it('keeps interleaved partial calls separated by provider index', () => {
    const calls = createStreamingState().toolCalls;
    processToolCallDelta(calls, {
      index: 1,
      id: 'call-b',
      function: { name: 'tool.', arguments: '{"b":' },
    });
    processToolCallDelta(calls, {
      index: 0,
      id: 'call-a',
      function: { name: 'other.', arguments: '{"a":' },
    });
    processToolCallDelta(calls, {
      index: 1,
      function: { name: 'run', arguments: '2}' },
    });
    processToolCallDelta(calls, {
      index: 0,
      function: { name: 'run', arguments: '1}' },
    });

    expect(finalizeStreamingState({ ...createStreamingState(), toolCalls: calls }).toolCalls).toEqual([
      { id: 'call-a', type: 'function', function: { name: 'other.run', arguments: '{"a":1}' } },
      { id: 'call-b', type: 'function', function: { name: 'tool.run', arguments: '{"b":2}' } },
    ]);
  });
});
