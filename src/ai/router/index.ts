/**
 * ORION Model Router
 * Handles routing requests to appropriate models based on role and task
 */

import type {
  ModelConfig,
  ModelRole,
  LLMProvider,
  LLMCompletionOptions,
  LLMCompletion,
  LLMCompletionChunk,
  LLMProviderConfig,
} from '../../types/index.js';
import { providerRegistry } from '../providers/base.js';
import { createOrionError } from '../../types/index.js';

export interface RouterConfig {
  models: ModelConfig[];
  defaultProvider: string;
}

export class ModelRouter {
  private models: ModelConfig[] = [];
  private providers = new Map<string, LLMProvider>();

  constructor(config: RouterConfig) {
    this.models = config.models.filter((m) => m.enabled);
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const providerConfigs = new Map<string, LLMProviderConfig>();

    for (const model of this.models) {
      if (!providerConfigs.has(model.provider)) {
        // Provider config would come from settings
        // For now, we'll create providers on-demand
      }
    }
  }

  private getProvider(model: ModelConfig): LLMProvider {
    const key = `${model.provider}:${model.model}`;
    let provider = this.providers.get(key);

    if (!provider) {
      // In a real implementation, this would load from settings
      const providerConfig: LLMProviderConfig = {
        baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
        apiKey: process.env.LLM_API_KEY || '',
        model: model.model,
      };

      try {
        provider = providerRegistry.create(model.provider, providerConfig);
        this.providers.set(key, provider);
      } catch (error) {
        throw createOrionError(
          'ROUTER_ERROR',
          `Failed to create provider for ${model.provider}/${model.model}`,
          `Cannot initialize AI model: ${model.model}`,
          { recoverable: false, suggestions: ['Check provider configuration', 'Verify API keys'] }
        );
      }
    }

    return provider;
  }

  getModelForTask(task?: string): ModelConfig | undefined {
    // First, try to find a task-specific model
    if (task) {
      const taskModel = this.models.find(
        (m) => m.role === 'task-specific' && m.tasks?.includes(task)
      );
      if (taskModel) return taskModel;
    }

    // Then try primary
    const primary = this.models.find((m) => m.role === 'primary');
    if (primary) return primary;

    // Fallback to any enabled model
    return this.models[0];
  }

  getModelForRole(role: ModelRole): ModelConfig | undefined {
    return this.models.find((m) => m.role === role);
  }

  async complete(options: LLMCompletionOptions, task?: string): Promise<LLMCompletion> {
    const model = this.getModelForTask(task);
    if (!model) {
      throw createOrionError(
        'ROUTER_ERROR',
        'No suitable model found',
        'No AI model available for this request',
        { recoverable: false, suggestions: ['Configure at least one AI model'] }
      );
    }

    const provider = this.getProvider(model);
    return provider.complete({ ...options, model: model.model });
  }

  async *streamComplete(options: LLMCompletionOptions, task?: string): AsyncIterable<LLMCompletionChunk> {
    const model = this.getModelForTask(task);
    if (!model) {
      throw createOrionError(
        'ROUTER_ERROR',
        'No suitable model found',
        'No AI model available for this request',
        { recoverable: false, suggestions: ['Configure at least one AI model'] }
      );
    }

    const provider = this.getProvider(model);
    yield* provider.streamComplete({ ...options, model: model.model });
  }

  async listAllModels(): Promise<string[]> {
    const allModels = new Set<string>();
    for (const model of this.models) {
      try {
        const provider = this.getProvider(model);
        const models = await provider.listModels();
        models.forEach((m) => allModels.add(`${model.provider}/${m}`));
      } catch {
        // Ignore errors, just add the configured model
        allModels.add(`${model.provider}/${model.model}`);
      }
    }
    return Array.from(allModels).sort();
  }

  getConfiguredModels(): ModelConfig[] {
    return [...this.models];
  }

  updateModels(models: ModelConfig[]): void {
    this.models = models.filter((m) => m.enabled);
    this.providers.clear(); // Clear cache to force recreation
  }
}

// Singleton instance
let routerInstance: ModelRouter | null = null;

export function createRouter(config: RouterConfig): ModelRouter {
  routerInstance = new ModelRouter(config);
  return routerInstance;
}

export function getRouter(): ModelRouter {
  if (!routerInstance) {
    throw createOrionError(
      'ROUTER_NOT_INITIALIZED',
      'Model router not initialized',
      'AI system not ready',
      { recoverable: false, suggestions: ['Initialize router first'] }
    );
  }
  return routerInstance;
}

export function resetRouter(): void {
  routerInstance = null;
}