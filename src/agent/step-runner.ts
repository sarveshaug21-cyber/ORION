/**
 * ORION Agent Step Runner
 * Executes a single agent step: reasoning → acting → executing → observing
 */

import type {
  AgentStep,
  AgentRun,
  AgentRunStatus,
  AgentRunLimits,
  AgentError,
  AgentErrorClass,
  ToolCall,
  ToolResult,
  LLMMessage,
  LLMToolCall,
  TokenUsage,
  AgentRunEvent,
} from '../types/agent.js';
import type { ToolExecutionContext, ToolDefinition, ToolRegistry, OrionError, ToolExecutionEvent } from '../types/index.js';
import { StreamAccumulator, formatToolResult, finalizeStreamingState } from '../ai/streaming/index.js';
import { ToolExecutionPipeline } from '../server/tool-execution.js';
import { ToolPermissionManager, PermissionDecision } from '../server/tool-permissions.js';
import type { ModelRouter } from '../ai/router/index.js';
import type { UserSettings } from '../types/index.js';
import { createOrionError, classifyError, DEFAULT_AGENT_LIMITS } from '../types/agent.js';

function orionErrorToAgentError(error: OrionError, stepId?: string, toolCallId?: string): AgentError {
  return {
    ...error,
    class: 'TOOL_ERROR' as const,
    recoverable: error.recoverable ?? true,
    stepId: stepId as any,
    toolCallId,
  };
}

function llmToolCallsToToolCalls(calls: LLMToolCall[]): ToolCall[] {
  return calls.map(c => ({
    id: c.id,
    toolName: c.function.name,
    arguments: JSON.parse(c.function.arguments || '{}'),
    status: 'pending' as const,
    startedAt: new Date(),
  }));
}

interface StepRunnerDeps {
  router: ModelRouter;
  toolRegistry: ToolRegistry;
  permissionManager: ToolPermissionManager;
  getSettings: () => UserSettings;
  createExecutionContext: (run: AgentRun, step: AgentStep) => ToolExecutionContext;
  eventEmitter: (event: AgentRunEvent) => void;
  now: () => number;
  generateId: () => string;
}

interface StepResult {
  step: AgentStep;
  shouldContinue: boolean;
  finalAnswer?: string;
  error?: AgentError;
}

/**
 * Heuristic to determine if planning is needed
 */
function shouldPlan(goal: string, limits: AgentRunLimits): boolean {
  // Simple heuristic: plan if goal suggests complexity
  const complexKeywords = [
    'multi-step', 'several', 'multiple', 'plan', 'strategy', 'analyze',
    'research', 'investigate', 'compare', 'evaluate', 'design', 'implement',
    'build', 'create', 'develop', 'write', 'refactor', 'migrate', 'deploy',
    'configure', 'setup', 'install', 'test', 'debug', 'optimize', 'automate',
    'workflow', 'pipeline', 'chain', 'sequence', 'orchestrate', 'coordinate'
  ];

  const lowerGoal = goal.toLowerCase();
  const hasComplexKeyword = complexKeywords.some(kw => lowerGoal.includes(kw));
  const hasMultipleSentences = goal.split(/[.!?]+/).filter(s => s.trim().length > 0).length > 1;
  const isLong = goal.length > 200;

  return hasComplexKeyword || hasMultipleSentences || isLong;
}

/**
 * Generate a plan using the model
 */
async function generatePlan(
  router: ModelRouter,
  run: AgentRun,
  step: AgentStep,
  context: ToolExecutionContext,
  settings: UserSettings,
  abortSignal: AbortSignal,
  generateId: () => string,
  toolRegistry: ToolRegistry
): Promise<string> {
  const planPrompt = `You are ORION, an AI assistant that creates execution plans for complex tasks.

Goal: ${run.goal}

Available tools: ${run.limits.maxToolCallsPerStep} tool calls per step, max ${run.limits.maxSteps} steps.

Create a concise, actionable plan with numbered steps. Each step should be specific and achievable with the available tools. Focus on the "what" not the "how".

Plan:`;

  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are a planning assistant. Create concise, actionable plans.' },
    { role: 'user', content: planPrompt },
  ];

  const tools = toolRegistry.list().map((t: ToolDefinition) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  })) ?? [];

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
 * Build model context for a step
 */
function buildModelContext(
  run: AgentRun,
  step: AgentStep,
  settings: UserSettings
): LLMMessage[] {
  const messages: LLMMessage[] = [];

  // System prompt
  messages.push({ role: 'system', content: settings.ai.systemPrompt });

  // Add plan if exists
  if (step.plan) {
    messages.push({ role: 'system', content: `Plan for this step:\n${step.plan}` });
  }

  // Add observation from previous step
  if (step.observation) {
    messages.push({ role: 'system', content: `Previous observation:\n${step.observation}` });
  }

  // Add conversation history (recent)
  // Note: In a real implementation, this would come from the conversation store
  // For now, we rely on the run's initial context

  // Add the goal as the user message for the first step
  if (step.stepIndex === 0) {
    messages.push({ role: 'user', content: run.goal });
  }

  return messages;
}

/**
 * Execute a single agent step
 */
export async function runStep(
  run: AgentRun,
  step: AgentStep,
  deps: StepRunnerDeps,
  abortSignal: AbortSignal
): Promise<StepResult> {
  const { router, toolRegistry, permissionManager, getSettings, createExecutionContext, eventEmitter, now, generateId } = deps;
  const settings = getSettings();
  const limits = run.limits;

  step.startedAt = new Date(now());
  step.status = 'REASONING';
  eventEmitter({
    type: 'STEP_STARTED',
    runId: run.id,
    stepId: step.id,
    timestamp: new Date().toISOString(),
    payload: { stepIndex: step.stepIndex, status: 'REASONING' },
  });

  // Check abort
  if (abortSignal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // Determine if this step needs planning
  const needsPlanning = step.stepIndex === 0 && shouldPlan(run.goal, limits) && !step.plan;

  if (needsPlanning) {
    step.status = 'PLANNING';
    eventEmitter({
      type: 'STEP_STARTED',
      runId: run.id,
      stepId: step.id,
      timestamp: new Date().toISOString(),
      payload: { stepIndex: step.stepIndex, status: 'PLANNING' },
    });

    try {
      const plan = await generatePlan(router, run, step, createExecutionContext(run, step), settings, abortSignal, generateId, deps.toolRegistry);
      step.plan = plan;
      eventEmitter({
        type: 'PLAN_UPDATED',
        runId: run.id,
        stepId: step.id,
        timestamp: new Date().toISOString(),
        payload: { plan, stepIndex: step.stepIndex },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // Planning failed, continue without plan
      step.plan = 'Planning failed, proceeding without plan';
    }
  }

  // Build model context
  const messages = buildModelContext(run, step, settings);
  const tools = toolRegistry.list().map((t: ToolDefinition) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));

  // REASONING: Stream from model
  step.status = 'REASONING';
  eventEmitter({
    type: 'STEP_STARTED',
    runId: run.id,
    stepId: step.id,
    timestamp: new Date().toISOString(),
    payload: { stepIndex: step.stepIndex, status: 'REASONING' },
  });

  const stream = new StreamAccumulator(undefined, abortSignal);
  let toolCalls: ToolCall[] = [];
  let modelOutputContent = '';

  try {
    for await (const chunk of router.streamComplete({
      messages,
      tools,
      toolChoice: 'auto',
      temperature: settings.ai.temperature,
      signal: abortSignal,
    })) {
      stream.process(chunk);
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        modelOutputContent += content;
      }
    }

    if (stream.isAborted()) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const { content, toolCalls: extractedCalls } = finalizeStreamingState(stream.getState());
    modelOutputContent = content;
    toolCalls = llmToolCallsToToolCalls(extractedCalls);

    // Record model output metadata
    step.modelOutput = {
      contentLength: modelOutputContent.length,
      toolCallCount: toolCalls.length,
    };
    step.modelInput = {
      messageCount: messages.length,
      hasSystemPrompt: true,
      hasToolResults: step.toolResults !== undefined && step.toolResults.length > 0,
    };

    // Estimate tokens (rough approximation)
    const estimatedTokens = Math.ceil((modelOutputContent.length + JSON.stringify(messages).length) / 4);
    step.tokensUsed = {
      prompt: Math.ceil(JSON.stringify(messages).length / 4),
      completion: Math.ceil(modelOutputContent.length / 4),
      total: estimatedTokens,
    };
    run.totalTokensUsed += estimatedTokens;

  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const agentError = classifyError(error, { stepId: step.id });
    step.error = agentError;
    step.status = 'FAILED';
    eventEmitter({
      type: 'STEP_FAILED',
      runId: run.id,
      stepId: step.id,
      timestamp: new Date().toISOString(),
      payload: { stepIndex: step.stepIndex, error: agentError, retryCount: step.retryCount },
    });
    return { step, shouldContinue: false, error: agentError };
  }

  // If no tool calls, this is a final answer
  if (toolCalls.length === 0) {
    step.completedAt = new Date(now());
    step.status = 'COMPLETED';
    eventEmitter({
      type: 'STEP_COMPLETED',
      runId: run.id,
      stepId: step.id,
      timestamp: new Date().toISOString(),
      payload: { stepIndex: step.stepIndex, hadToolCalls: false, tokensUsed: step.tokensUsed!, durationMs: Date.now() - step.startedAt.getTime() },
    });
    return { step, shouldContinue: false, finalAnswer: modelOutputContent };
  }

  // ACTING: Emit tool calls ready event
  step.status = 'ACTING';
  eventEmitter({
    type: 'TOOL_CALLS_READY',
    runId: run.id,
    stepId: step.id,
    timestamp: new Date().toISOString(),
    payload: {
      toolCalls: toolCalls.map(tc => ({
        id: tc.id,
        name: tc.toolName,
        arguments: tc.arguments,
      })),
      stepIndex: step.stepIndex,
    },
  });

  // Validate tool calls against limits
  if (toolCalls.length > limits.maxToolCallsPerStep) {
    const error = orionErrorToAgentError(createOrionError(
      'TOOL_LIMIT_EXCEEDED',
      `Too many tool calls in one step: ${toolCalls.length} > ${limits.maxToolCallsPerStep}`,
      `Model requested too many tool calls`,
      { recoverable: false }
    ), step.id);
    step.error = error;
    step.status = 'FAILED';
    return { step, shouldContinue: false, error };
  }

  // EXECUTING: Dispatch tools through pipeline
  step.status = 'EXECUTING';
  const executionContext = createExecutionContext(run, step);
  const toolResults: Array<{ toolCall: ToolCall; result: ToolResult }> = [];
  let totalToolCalls = run.steps.flatMap(s => s.toolCalls ?? []).length;

  eventEmitter({
    type: 'TOOLS_DISPATCHED',
    runId: run.id,
    stepId: step.id,
    timestamp: new Date().toISOString(),
    payload: {
      toolCallIds: toolCalls.map(tc => tc.id),
      stepIndex: step.stepIndex,
    },
  });

  // Create execution pipeline
  const pipeline = new ToolExecutionPipeline({
    registry: {
      get: (name: string) => toolRegistry.get(name),
      validateArguments: (name: string, args: Record<string, unknown>) => toolRegistry.validateArguments(name, args),
      execute: (name: string, args: Record<string, unknown>, ctx: ToolExecutionContext, toolCallId?: string) =>
        toolRegistry.execute(name, args, ctx, toolCallId),
    },
    emit: (event: ToolExecutionEvent) => {
      // Forward all tool execution events to the agent event emitter
      eventEmitter({
        type: event.type as any,
        runId: run.id,
        stepId: step.id,
        timestamp: event.timestamp,
        payload: {
          ...event,
          stepIndex: step.stepIndex,
          retryCount: 0,
        } as any,
      });
    },
    requestPermission: async (request) => {
      // Create a temporary owner object for this run
      const owner = { runId: run.id };
      return permissionManager.request(request.id, run.sessionId, owner);
    },
    executionTimeoutMs: limits.stepTimeoutMs,
  });

  // Execute each tool call
  for (const toolCall of toolCalls) {
    if (abortSignal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // Check total tool call limit
    totalToolCalls++;
    if (totalToolCalls > limits.maxTotalToolCalls) {
      const error = orionErrorToAgentError(createOrionError(
        'TOOL_LIMIT_EXCEEDED',
        `Total tool call limit exceeded: ${totalToolCalls} > ${limits.maxTotalToolCalls}`,
        `Maximum tool calls reached`,
        { recoverable: false }
      ), step.id);
      step.error = error;
      step.status = 'FAILED';
      return { step, shouldContinue: false, error };
    }

    const request = {
      id: toolCall.id,
      toolName: toolCall.toolName,
      arguments: toolCall.arguments,
      conversationId: run.conversationId,
      context: executionContext,
      requireConfirmationFor: settings.permissions.requireConfirmationFor,
    };

    const result = await pipeline.execute(request);
    toolResults.push({ toolCall, result });

    // Add assistant message with tool calls to conversation history
    // (handled by the existing message persistence in server/index.ts)
  }

  // OBSERVING: Generate observation from tool results
  step.status = 'OBSERVING';
  step.toolCalls = toolCalls;
  step.toolResults = toolResults;

  const observation = generateObservation(toolResults);
  step.observation = observation;

  eventEmitter({
    type: 'TOOLS_COMPLETED',
    runId: run.id,
    stepId: step.id,
    timestamp: new Date().toISOString(),
    payload: {
      results: toolResults.map(tr => ({
        toolCallId: tr.toolCall.id,
        success: tr.result.success,
        hasError: !!tr.result.error,
      })),
      stepIndex: step.stepIndex,
    },
  });

  eventEmitter({
    type: 'OBSERVATION_GENERATED',
    runId: run.id,
    stepId: step.id,
    timestamp: new Date().toISOString(),
    payload: { observation, stepIndex: step.stepIndex },
  });

  step.completedAt = new Date(now());
  step.status = 'COMPLETED';

  eventEmitter({
    type: 'STEP_COMPLETED',
    runId: run.id,
    stepId: step.id,
    timestamp: new Date().toISOString(),
    payload: {
      stepIndex: step.stepIndex,
      hadToolCalls: true,
      tokensUsed: step.tokensUsed,
      durationMs: Date.now() - step.startedAt.getTime(),
    },
  });

  // Determine if we should continue
  const shouldContinue = run.steps.length < limits.maxSteps &&
    !abortSignal.aborted &&
    totalToolCalls < limits.maxTotalToolCalls;

  return { step, shouldContinue };
}

/**
 * Generate a deterministic observation from tool results
 */
function generateObservation(results: Array<{ toolCall: ToolCall; result: ToolResult }>): string {
  if (results.length === 0) return 'No tools executed.';

  const parts: string[] = [];
  for (const { toolCall, result } of results) {
    if (result.success) {
      parts.push(`✓ ${toolCall.toolName}: ${formatToolResult(result.data).slice(0, 200)}`);
    } else {
      parts.push(`✗ ${toolCall.toolName} failed: ${result.error}`);
    }
  }
  return parts.join('\n');
}