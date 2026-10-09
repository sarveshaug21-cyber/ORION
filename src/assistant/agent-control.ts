/**
 * ORION Assistant Agent Control
 * Handles starting, cancelling, resuming agent runs
 */

import type {
  AssistantAction,
  AssistantContext,
  AssistantActionResult,
} from '../types/assistant.js';
import type { AgentRunId, AgentRunInput } from '../types/agent.js';
import { runController } from '../agent/run-controller.js';

/**
 * Start an agent run using the existing agentRuntime from deps
 */
export async function startAgentRun(
  action: any,
  context: AssistantContext,
  deps: any
): Promise<any> {
  // Use the existing agentRuntime from deps instead of creating a new one
  const agentRuntime = deps.agentRuntime;
  
  if (!agentRuntime) {
    return { success: false, error: 'AgentRuntime not available in deps' };
  }

  const runId = await agentRuntime.start({
    type: 'agent_start',
    sessionId: context.session.sessionId,
    conversationId: context.conversation.id,
    userId: context.session.userId,
    goal: action.goal,
    limits: action.limits,
    initialContext: {
      systemPrompt: context.userSettings.ai.systemPrompt,
      shortTermMemories: context.shortTermMemories.map(m => m.content),
      relevantMemories: context.relevantMemories.map(m => m.content),
      conversationHistoryLength: context.conversationHistory.length,
    },
  });

  return { success: true, data: { runId } };
}

/**
 * Resume an agent run
 */
export async function resumeAgentRun(
  action: any,
  context: AssistantContext,
  deps: any
): Promise<any> {
  const agentRuntime = deps.agentRuntime;
  
  if (!agentRuntime) {
    return { success: false, error: 'AgentRuntime not available in deps' };
  }

  if (!action.runId) {
    return { success: false, error: 'Run ID required for resume' };
  }

  try {
    await agentRuntime.resume(action.runId);
    return { success: true, data: { runId: action.runId } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to resume agent run' };
  }
}

/**
 * Cancel an agent run
 */
export async function cancelAgentRun(
  action: any,
  context: AssistantContext,
  deps: any
): Promise<any> {
  const agentRuntime = deps.agentRuntime;
  
  if (!agentRuntime) {
    return { success: false, error: 'AgentRuntime not available in deps' };
  }

  if (action.runId) {
    await agentRuntime.cancel(action.runId, 'Cancelled by user');
    return { success: true, data: { runId: action.runId } };
  }
  return { success: false, error: 'Run ID required' };
}

/**
 * Execute agent control action
 */
export async function executeAgentControl(
  action: any,
  context: AssistantContext,
  deps: any
): Promise<any> {
  switch (action.operation) {
    case 'status': {
      const agentRuntime = deps.agentRuntime;
      if (!agentRuntime) {
        return { success: false, error: 'AgentRuntime not available in deps' };
      }
      // Get all active runs
      const runs = Array.from((agentRuntime as any).activeRuns?.values() || []).map((r: any) => ({
        runId: r.run.id,
        goal: r.run.goal,
        status: r.run.status,
        currentStep: r.run.currentStepIndex,
      }));
      return { success: true, data: { runs } };
    }
    case 'cancel':
      return await cancelAgentRun(action, context, deps);
    case 'resume':
      return await resumeAgentRun(action, context, deps);
    case 'list': {
      const agentRuntime = deps.agentRuntime;
      if (!agentRuntime) {
        return { success: false, error: 'AgentRuntime not available in deps' };
      }
      const runs = Array.from((agentRuntime as any).activeRuns?.values() || []).map((r: any) => ({
        runId: r.run.id,
        goal: r.run.goal,
        status: r.run.status,
        currentStep: r.run.currentStepIndex,
      }));
      return { success: true, data: { runs } };
    }
    default:
      return { success: false, error: `Unknown agent control operation: ${action.operation}` };
  }
}