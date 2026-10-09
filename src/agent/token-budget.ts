/**
 * ORION Agent Token Budget
 * Manages token accounting, budgeting, and context truncation
 */

import type { LLMMessage, AgentRun, AgentStep, AgentRunLimits, TokenUsage } from '../types/agent.js';
import type { UserSettings } from '../types/index.js';

/**
 * Rough token estimation (1 token ≈ 4 characters for English)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a message array
 */
export function estimateMessageTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content);
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        total += estimateTokens(tc.function.name);
        total += estimateTokens(tc.function.arguments);
      }
    }
  }
  return total;
}

/**
 * Token budget configuration
 */
export interface TokenBudgetConfig {
  maxTokens: number;
  reservedForResponse: number;
  reservedForTools: number;
  systemPromptTokens: number;
  minHistoryTokens: number;
}

/**
 * Default token budget configuration
 */
export function createDefaultTokenBudget(limits: AgentRunLimits, settings: UserSettings): TokenBudgetConfig {
  const modelMaxTokens = limits.maxTokens ?? settings.ai.maxTokens;
  const responseBuffer = Math.min(2000, modelMaxTokens * 0.1);
  const toolsBuffer = Math.min(1000, modelMaxTokens * 0.05);

  return {
    maxTokens: modelMaxTokens,
    reservedForResponse: responseBuffer,
    reservedForTools: toolsBuffer,
    systemPromptTokens: 0, // Will be calculated
    minHistoryTokens: Math.floor((modelMaxTokens - responseBuffer - toolsBuffer) * 0.3),
  };
}

/**
 * Calculate system prompt tokens
 */
export function calculateSystemPromptTokens(systemPrompt: string, memories: string[]): number {
  let tokens = estimateTokens(systemPrompt);
  for (const mem of memories) {
    tokens += estimateTokens(mem);
  }
  return tokens;
}

/**
 * Build messages within token budget
 * Preserves: system prompt, recent conversation, recent tool results, memories
 */
export function buildMessagesWithinBudget(
  run: AgentRun,
  step: AgentStep,
  settings: UserSettings,
  budget: TokenBudgetConfig
): LLMMessage[] {
  const messages: LLMMessage[] = [];

  // 1. System prompt (always included)
  const systemPrompt = settings.ai.systemPrompt;
  const memoryTokens = estimateTokens(run.initialContext?.shortTermMemories.join('\n') || '') +
    estimateTokens(run.initialContext?.relevantMemories.join('\n') || '');
  budget.systemPromptTokens = estimateTokens(systemPrompt) + memoryTokens;

  messages.push({ role: 'system', content: systemPrompt });

  // Add memories as system context
  if (run.initialContext?.shortTermMemories?.length) {
    messages.push({
      role: 'system',
      content: `Short-term context:\n${run.initialContext.shortTermMemories.join('\n')}`,
    });
  }

  if (run.initialContext?.relevantMemories?.length) {
    messages.push({
      role: 'system',
      content: `Relevant memories:\n${run.initialContext.relevantMemories.join('\n')}`,
    });
  }

  // 2. Add plan if exists
  if (step.plan) {
    messages.push({ role: 'system', content: `Plan:\n${step.plan}` });
  }

  // 3. Add observation from previous step
  if (step.observation) {
    messages.push({ role: 'system', content: `Observation:\n${step.observation}` });
  }

  // 4. Add conversation history (from newest to oldest, within budget)
  // Note: In a real implementation, this would come from the conversation store
  // For now, we rely on the run's initial context
  if (run.initialContext?.conversationHistoryLength && run.initialContext.conversationHistoryLength > 0) {
    // Placeholder - would fetch actual messages from database
    // messages.push(...fetchRecentMessages(run.conversationId, budget.minHistoryTokens));
  }

  // 5. Add the user goal for the first step
  if (step.stepIndex === 0) {
    messages.push({ role: 'user', content: run.goal });
  }

  // 6. Add previous assistant messages and tool results from previous steps
  for (const prevStep of run.steps) {
    if (prevStep.stepIndex >= step.stepIndex) break;
    if (prevStep.status !== 'COMPLETED') continue;

    if (prevStep.modelOutput?.contentLength && prevStep.modelOutput.contentLength > 0) {
      // Would add the actual assistant message here
      // For now, we track it conceptually
    }
  }

  return messages;
}

/**
 * Check if we're within token budget
 */
export function checkTokenBudget(
  currentTokens: number,
  budget: TokenBudgetConfig
): { withinBudget: boolean; remainingTokens: number } {
  const available = budget.maxTokens - budget.reservedForResponse - budget.reservedForTools;
  const remaining = available - currentTokens;
  return {
    withinBudget: remaining >= 0,
    remainingTokens: remaining,
  };
}

/**
 * Truncate messages to fit within budget
 * Removes oldest conversation history first, preserves system prompt and recent context
 */
export function truncateToBudget(
  messages: LLMMessage[],
  budget: TokenBudgetConfig,
  currentTokens: number
): LLMMessage[] {
  const available = budget.maxTokens - budget.reservedForResponse - budget.reservedForTools;
  
  if (currentTokens <= available) {
    return messages;
  }

  // Strategy: Remove oldest non-system messages first
  const systemMessages = messages.filter(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');

  // Keep system messages, truncate others from the beginning (oldest)
  let tokens = estimateMessageTokens(systemMessages);
  const result: LLMMessage[] = [...systemMessages];

  for (const msg of otherMessages) {
    const msgTokens = estimateTokens(msg.content);
    if (tokens + msgTokens <= available) {
      result.push(msg);
      tokens += msgTokens;
    } else {
      break;
    }
  }

  return result;
}

/**
 * Track token usage for a step
 */
export function trackStepTokens(step: AgentStep, messages: LLMMessage[], responseContent: string): TokenUsage {
  const promptTokens = estimateMessageTokens(messages);
  const completionTokens = estimateTokens(responseContent);
  
  return {
    prompt: promptTokens,
    completion: completionTokens,
    total: promptTokens + completionTokens,
  };
}

/**
 * Get total tokens used in a run
 */
export function getRunTokenUsage(run: AgentRun): number {
  return run.totalTokensUsed;
}

/**
 * Check if run has exceeded token budget
 */
export function hasExceededTokenBudget(run: AgentRun, budget: TokenBudgetConfig): boolean {
  const available = budget.maxTokens - budget.reservedForResponse - budget.reservedForTools;
  return run.totalTokensUsed > available;
}

/**
 * Estimate tokens needed for next step
 */
export function estimateNextStepTokens(
  run: AgentRun,
  step: AgentStep,
  settings: UserSettings
): number {
  const baseTokens = estimateTokens(settings.ai.systemPrompt);
  const memoryTokens = estimateTokens(run.initialContext?.shortTermMemories.join('\n') || '') +
    estimateTokens(run.initialContext?.relevantMemories.join('\n') || '');
  const planTokens = step.plan ? estimateTokens(step.plan) : 0;
  const observationTokens = step.observation ? estimateTokens(step.observation) : 0;
  const historyTokens = run.steps
    .filter(s => s.stepIndex < step.stepIndex && s.status === 'COMPLETED')
    .reduce((sum, s) => sum + (s.tokensUsed?.total || 0), 0);

  return baseTokens + memoryTokens + planTokens + observationTokens + historyTokens + 1000; // buffer for response
}