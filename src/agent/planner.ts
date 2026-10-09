/**
 * ORION Agent Planner
 * Adaptive planning for complex tasks
 */

import type {
  AgentRun,
  AgentStep,
  AgentRunLimits,
  AgentRunEvent,
  AgentRunId,
  StepId,
} from '../types/agent.js';
import type { ToolExecutionContext, ToolDefinition, ToolRegistry } from '../types/index.js';
import type { ModelRouter } from '../ai/router/index.js';
import type { UserSettings } from '../types/index.js';
import { StreamAccumulator } from '../ai/streaming/index.js';
import { createOrionError } from '../types/index.js';

interface PlannerDeps {
  router: ModelRouter;
  toolRegistry: ToolRegistry;
  getSettings: () => UserSettings;
  eventEmitter: (event: AgentRunEvent) => void;
  generateId: () => string;
}

/**
 * Heuristic to determine if planning is needed
 * This avoids an extra LLM call just to decide whether to plan
 */
export function shouldPlan(goal: string, limits: AgentRunLimits): boolean {
  const complexKeywords = [
    'multi-step', 'several', 'multiple', 'plan', 'strategy', 'analyze',
    'research', 'investigate', 'compare', 'evaluate', 'design', 'implement',
    'build', 'create', 'develop', 'write', 'refactor', 'migrate', 'deploy',
    'configure', 'setup', 'install', 'test', 'debug', 'optimize', 'automate',
    'workflow', 'pipeline', 'chain', 'sequence', 'orchestrate', 'coordinate',
    'and then', 'after that', 'followed by', 'step by step',
  ];

  const lowerGoal = goal.toLowerCase();
  const hasComplexKeyword = complexKeywords.some(kw => lowerGoal.includes(kw));
  const hasMultipleSentences = goal.split(/[.!?]+/).filter(s => s.trim().length > 0).length > 1;
  const isLong = goal.length > 200;
  const hasConjunctions = /(and|then|after|before|while|during)/.test(lowerGoal);

  return hasComplexKeyword || hasMultipleSentences || isLong || hasConjunctions;
}

/**
 * Generate a plan using the model
 */
export async function generatePlan(
  deps: PlannerDeps,
  run: AgentRun,
  step: AgentStep,
  context: ToolExecutionContext,
  abortSignal: AbortSignal
): Promise<string> {
  const { router, toolRegistry, getSettings, eventEmitter, generateId } = deps;
  const settings = getSettings();

  // Build tool descriptions for the planner
  const toolDescriptions = toolRegistry.list()
    .filter(t => t.permissionLevel !== 'REQUIRES_CONFIRMATION' || settings.permissions.requireConfirmationFor.includes('REQUIRES_CONFIRMATION'))
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');

  const planPrompt = `You are ORION, an AI assistant that creates execution plans for complex tasks.

Goal: ${run.goal}

Available tools:
${toolDescriptions}

Constraints:
- Max ${run.limits.maxToolCallsPerStep} tool calls per step
- Max ${run.limits.maxSteps} steps total
- Max ${run.limits.maxTotalToolCalls} total tool calls

Create a concise, actionable plan with numbered steps. Each step should be specific and achievable with the available tools. Focus on the "what" not the "how".

Plan:`;

  const messages = [
    { role: 'system' as const, content: 'You are a planning assistant. Create concise, actionable plans.' },
    { role: 'user' as const, content: planPrompt },
  ];

  const tools = toolRegistry.list().map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));

  const stream = new StreamAccumulator(undefined, abortSignal);
  for await (const chunk of router.streamComplete({
    messages,
    tools,
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

/**
 * Replan after observing tool results
 */
export async function replan(
  deps: PlannerDeps,
  run: AgentRun,
  step: AgentStep,
  context: ToolExecutionContext,
  abortSignal: AbortSignal
): Promise<string> {
  const { router, toolRegistry, getSettings, generateId } = deps;
  const settings = getSettings();

  // Build context from completed steps
  const completedSteps = run.steps
    .filter(s => s.status === 'COMPLETED' && s.completedAt)
    .map(s => `Step ${s.stepIndex + 1}: ${s.plan || 'Execute tools'} → ${s.observation || 'Done'}`)
    .join('\n');

  const toolDescriptions = toolRegistry.list()
    .filter(t => t.permissionLevel !== 'REQUIRES_CONFIRMATION' || settings.permissions.requireConfirmationFor.includes('REQUIRES_CONFIRMATION'))
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');

  const replanPrompt = `You are ORION, an AI assistant that revises execution plans based on observations.

Original Goal: ${run.goal}

Completed Steps:
${completedSteps || 'None yet'}

Current Observation: ${step.observation || 'No observation'}

Available Tools:
${toolDescriptions}

Constraints:
- Remaining steps: ${run.limits.maxSteps - run.currentStepIndex - 1}
- Remaining tool calls: ${run.limits.maxTotalToolCalls - run.steps.flatMap(s => s.toolCalls ?? []).length}

Revise the plan for remaining steps. Be specific about what to do next.

Revised Plan:`;

  const messages = [
    { role: 'system' as const, content: 'You are a planning assistant. Revise plans based on observations.' },
    { role: 'user' as const, content: replanPrompt },
  ];

  const tools = toolRegistry.list().map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));

  const stream = new StreamAccumulator(undefined, abortSignal);
  for await (const chunk of router.streamComplete({
    messages,
    tools,
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
  return plan || 'No revised plan generated';
}