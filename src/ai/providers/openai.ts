/**
 * ORION OpenAI-Compatible Provider
 * Supports OpenAI API and compatible endpoints (Ollama, LM Studio, etc.)
 */

import OpenAI from 'openai';
import type {
  LLMProviderConfig,
  LLMCompletion,
  LLMCompletionChunk,
  LLMCompletionOptions,
} from '../../types/index.js';
import { BaseLLMProvider, ProviderFactory, providerRegistry } from './base.js';
import { createOrionError } from '../../types/index.js';

export class OpenAICompatibleProvider extends BaseLLMProvider {
  private client: OpenAI;

  constructor(config: LLMProviderConfig) {
    super('openai-compatible', config);
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      defaultHeaders: config.defaultHeaders,
      dangerouslyAllowBrowser: false,
    });
  }

  async complete(options: LLMCompletionOptions): Promise<LLMCompletion> {
    const { messages, tools, toolChoice, temperature, maxTokens, model, signal } = options;

    try {
      const completion = await this.client.chat.completions.create({
        model: model || this.config.model,
        messages: this.formatMessages(messages) as any,
        tools: this.formatTools(tools) as any,
        tool_choice: toolChoice as any,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens,
        stream: false,
      }, { signal });

      return this.mapCompletion(completion);
    } catch (error) {
      throw this.handleOpenAIError(error, 'complete');
    }
  }

  async *streamComplete(options: LLMCompletionOptions): AsyncIterable<LLMCompletionChunk> {
    const { messages, tools, toolChoice, temperature, maxTokens, model, signal } = options;

    try {
      const stream = await this.client.chat.completions.create({
        model: model || this.config.model,
        messages: this.formatMessages(messages) as any,
        tools: this.formatTools(tools) as any,
        tool_choice: toolChoice as any,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens,
        stream: true,
      }, { signal });

      for await (const chunk of stream) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        yield this.mapChunk(chunk);
      }
    } catch (error) {
      throw this.handleOpenAIError(error, 'streamComplete');
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const models = await this.client.models.list();
      return models.data.map((m) => m.id).sort();
    } catch {
      // Fallback to known models if list fails
      return [this.config.model, 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
    }
  }

  private mapCompletion(completion: OpenAI.Chat.Completions.ChatCompletion): LLMCompletion {
    const choice = completion.choices[0];
    const message = choice.message;

    return {
      id: completion.id,
      choices: [
        {
          message: {
            role: message.role,
            content: message.content || '',
            toolCalls: message.tool_calls?.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
            toolCallId: undefined,
          },
          index: 0,
          finishReason: choice.finish_reason,
        },
      ],
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
    };
  }

  private mapChunk(chunk: OpenAI.Chat.Completions.ChatCompletionChunk): LLMCompletionChunk {
    const choice = chunk.choices[0];
    const delta = choice.delta;

    return {
      id: chunk.id,
      choices: [
        {
          delta: {
            content: delta.content || undefined,
            toolCalls: delta.tool_calls?.map((tc) => ({
              index: tc.index,
              id: tc.id,
              type: 'function' as const,
              function: {
                ...(tc.function?.name ? { name: tc.function.name } : {}),
                ...(tc.function?.arguments ? { arguments: tc.function.arguments } : {}),
              },
            })),
            role: delta.role,
          },
          index: 0,
          finishReason: choice.finish_reason,
        },
      ],
    };
  }

  private handleOpenAIError(error: unknown, context: string): never {
    if (error instanceof OpenAI.APIError) {
      throw createOrionError(
        'LLM_PROVIDER_ERROR',
        `${context}: ${error.message}`,
        `AI request failed: ${error.message}`,
        {
          recoverable: error.status >= 500 || error.status === 429,
          suggestions:
            error.status === 401
              ? ['Check your API key']
              : error.status === 429
              ? ['Wait and retry', 'Reduce request frequency']
              : error.status === 400
              ? ['Check request format', 'Validate tool schemas']
              : undefined,
          context: { provider: this.name, status: error.status, code: error.code },
        }
      );
    }
    throw createOrionError(
      'LLM_PROVIDER_ERROR',
      `${context}: ${error}`,
      'AI request failed unexpectedly',
      { recoverable: true, context: { provider: this.name } }
    );
  }
}

export const openaiFactory: ProviderFactory = {
  name: 'openai-compatible',
  supportedModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'custom'],
  create(config: LLMProviderConfig): OpenAICompatibleProvider {
    return new OpenAICompatibleProvider(config);
  },
};

// Auto-register
providerRegistry.register(openaiFactory);