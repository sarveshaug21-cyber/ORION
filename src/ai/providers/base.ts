/**
 * ORION LLM Provider Base Classes
 * Abstract base for all LLM providers
 */

import type {
  LLMProvider,
  LLMProviderConfig,
  LLMMessage,
  LLMToolDefinition,
  LLMCompletion,
  LLMCompletionChunk,
  LLMCompletionOptions,
} from '../../types/index.js';
import { createOrionError } from '../../types/index.js';

export abstract class BaseLLMProvider implements LLMProvider {
  public readonly name: string;
  public readonly config: LLMProviderConfig;

  constructor(name: string, config: LLMProviderConfig) {
    this.name = name;
    this.config = config;
  }

  abstract complete(options: LLMCompletionOptions): Promise<LLMCompletion>;
  abstract streamComplete(options: LLMCompletionOptions): AsyncIterable<LLMCompletionChunk>;
  abstract listModels(): Promise<string[]>;

  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.defaultHeaders,
    };
  }

  protected buildUrl(endpoint: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}${endpoint}`;
  }

  protected async handleError(response: Response, context: string): Promise<never> {
    let errorData: any;
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: await response.text() };
    }

    const message = errorData.error?.message || errorData.message || `HTTP ${response.status}`;
    throw createOrionError(
      `LLM_PROVIDER_ERROR`,
      `${context}: ${message}`,
      `Failed to ${context.toLowerCase()}: ${message}`,
      {
        recoverable: response.status >= 500 || response.status === 429,
        suggestions: response.status === 401 ? ['Check your API key'] : response.status === 429 ? ['Wait and retry'] : undefined,
        context: { provider: this.name, status: response.status, endpoint: context },
      }
    );
  }

  protected formatMessages(messages: LLMMessage[]): LLMMessage[] {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      ...(msg.toolCallId && { tool_call_id: msg.toolCallId }),
      ...(msg.toolCalls && { tool_calls: msg.toolCalls }),
      ...(msg.name && { name: msg.name }),
    }));
  }

  protected formatTools(tools?: LLMToolDefinition[]): LLMToolDefinition[] | undefined {
    return tools;
  }
}

export interface ProviderFactory {
  create(config: LLMProviderConfig): LLMProvider;
  readonly name: string;
  readonly supportedModels: string[];
}

export class ProviderRegistry {
  private factories = new Map<string, ProviderFactory>();

  register(factory: ProviderFactory): void {
    this.factories.set(factory.name, factory);
  }

  unregister(name: string): void {
    this.factories.delete(name);
  }

  get(name: string): ProviderFactory | undefined {
    return this.factories.get(name);
  }

  list(): ProviderFactory[] {
    return Array.from(this.factories.values());
  }

  create(name: string, config: LLMProviderConfig): LLMProvider {
    const factory = this.factories.get(name);
    if (!factory) {
      throw createOrionError(
        'PROVIDER_NOT_FOUND',
        `Provider "${name}" not found`,
        `Unknown AI provider: ${name}`,
        { recoverable: false, suggestions: ['Check provider name', 'Register provider first'] }
      );
    }
    return factory.create(config);
  }
}

export const providerRegistry = new ProviderRegistry();