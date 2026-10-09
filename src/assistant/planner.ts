/**
 * ORION Assistant Planner
 * Intent classification and action planning
 */

import type {
  AssistantIntent,
  AssistantAction,
  AssistantContext,
} from '../types/assistant.js';
import { createRouter } from '../ai/router/index.js';
import { StreamAccumulator } from '../ai/streaming/index.js';
import type { ModelRouter } from '../ai/router/index.js';
import { generateId } from '../lib/utils.js';

const INTENT_KEYWORDS: Record<AssistantIntent, string[]> = {
  CHAT: ['hello', 'hi', 'hey', 'how are you', 'thanks', 'thank you', 'bye', 'goodbye'],
  QUESTION: ['what', 'why', 'how', 'when', 'where', 'who', 'which', 'explain', 'define', '?'],
  MEMORY_READ: ['remember', 'recall', 'what did i', 'what do you know', 'find memory', 'search memory'],
  MEMORY_WRITE: ['remember this', 'save this', 'note that', 'memorize', 'store this'],
  FILE_OPERATION: ['file', 'read file', 'write file', 'list files', 'search file', 'find file', 'create file', 'delete file', 'move file'],
  OBSIDIAN_OPERATION: ['obsidian', 'note', 'vault', 'markdown note', 'create note', 'search note'],
  TASK: ['task', 'todo', 'remind me', 'create task', 'add task', 'complete task'],
  AGENT_TASK: ['run', 'execute', 'automate', 'build', 'implement', 'fix', 'refactor', 'test', 'deploy', 'analyze'],
  SYSTEM_ACTION: ['status', 'settings', 'health', 'version'],
  AGENT_CONTROL: ['stop', 'cancel', 'pause', 'resume', 'continue', 'agent status', 'agent cancel'],
  CLARIFICATION_REQUIRED: [],
  UNKNOWN: [],
};

const AGENT_TASK_KEYWORDS = [
  'implement', 'build', 'create', 'fix', 'refactor', 'refactoring',
  'test', 'testing', 'deploy', 'analyze', 'investigate', 'debug',
  'migrate', 'upgrade', 'optimize', 'automate', 'script', 'pipeline',
  'workflow', 'orchestrate', 'coordinate', 'multi-step', 'complex',
];

/**
 * Heuristic to determine if planning is needed
 */
export function shouldPlan(goal: string): boolean {
  const lower = goal.toLowerCase();
  return AGENT_TASK_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Classify user intent using heuristics first, then LLM if needed
 */
export async function classifyIntent(
  content: string,
  context: { sessionId: string; conversationHistory: any[] }
): Promise<{ intent: AssistantIntent; confidence: number; action?: AssistantAction }> {
  const lower = content.toLowerCase();

  // Direct keyword matching for high-confidence intents
  const intentKeys = Object.keys(INTENT_KEYWORDS) as AssistantIntent[];
  for (const intent of intentKeys) {
    const keywords = INTENT_KEYWORDS[intent];
    if (keywords.some(kw => lower.includes(kw))) {
      return { intent, confidence: 0.9, action: createDefaultAction(intent, content) };
    }
  }

  // Check for agent task keywords
  if (shouldPlan(content)) {
    return { intent: 'AGENT_TASK', confidence: 0.85, action: { type: 'AGENT_TASK', goal: content } };
  }

  // Default to question for question-like patterns
  if (content.trim().endsWith('?') || /^(what|why|how|when|where|who|which|explain|define)/i.test(content.trim())) {
    return { intent: 'QUESTION', confidence: 0.75, action: { type: 'CHAT_RESPONSE', content: 'I\'ll help you with that question.' } };
  }

  // Default to chat
  return { intent: 'CHAT', confidence: 0.6, action: { type: 'CHAT_RESPONSE', content: 'Hello! How can I help you?' } };
}

/**
 * Create a default action for a given intent
 */
function createDefaultAction(intent: AssistantIntent, content: string): AssistantAction {
  switch (intent) {
    case 'MEMORY_READ':
      return { type: 'MEMORY_READ', query: content, limit: 10 };
    case 'MEMORY_WRITE':
      return { type: 'MEMORY_WRITE', content, category: 'context', importance: 50, tags: [] };
    case 'FILE_OPERATION':
      return { type: 'FILE_OPERATION', operation: 'list', path: '.' };
    case 'OBSIDIAN_OPERATION':
      return { type: 'OBSIDIAN_OPERATION', operation: 'search', query: content };
    case 'TASK':
      return { type: 'TASK_OPERATION', operation: 'list' };
    case 'AGENT_TASK':
      return { type: 'AGENT_TASK', goal: content };
    case 'SYSTEM_ACTION':
      return { type: 'SYSTEM_ACTION', action: 'status' };
    case 'AGENT_CONTROL':
      return { type: 'AGENT_CONTROL', operation: 'status' };
    case 'QUESTION':
      return { type: 'CHAT_RESPONSE', content: 'I\'ll help you with that question.' };
    case 'CHAT':
      return { type: 'CHAT_RESPONSE', content: 'Hello! How can I help you?' };
    default:
      return { type: 'CHAT_RESPONSE', content: 'I\'m not sure how to help with that.' };
  }
}

/**
 * Generate a plan using the model
 */
export async function generatePlan(
  router: ModelRouter,
  goal: string,
  context: any,
  abortSignal: AbortSignal,
  generateId: () => string
): Promise<string> {
  const planPrompt = `You are ORION, an AI assistant that creates execution plans for complex tasks.

Goal: ${goal}

Available tools: filesystem, terminal, browser, system, memory, skills.

Constraints:
- Max 10 steps
- Max 5 tool calls per step
- Max 25 total tool calls
- Max 5 minutes execution time

Create a concise, actionable plan with numbered steps. Each step should be specific and achievable with the available tools. Focus on the "what" not the "how".

Plan:`;

  const messages = [
    { role: 'system' as const, content: 'You are a planning assistant. Create concise, actionable plans.' },
    { role: 'user' as const, content: planPrompt },
  ];

  const stream = new StreamAccumulator(undefined, abortSignal);
  for await (const chunk of createRouter({
    models: [{
      provider: 'openai-compatible',
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      role: 'primary',
      enabled: true,
    }],
    defaultProvider: 'openai-compatible',
  }).streamComplete({
    messages,
    tools: [],
    toolChoice: 'none',
    temperature: 0.3,
    signal: abortSignal,
  })) {
    stream.process(chunk);
  }

  if (stream.isAborted()) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const plan = stream.getContent().trim();
  return plan || 'No plan generated';
}