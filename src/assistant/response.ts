/**
 * ORION Assistant Response Generation
 * Generates natural language responses for the assistant
 */

import type {
  AssistantIntent,
  AssistantAction,
  AssistantActionResult,
  AssistantContext,
} from '../types/assistant.js';
import { createRouter } from '../ai/router/index.js';
import { StreamAccumulator } from '../ai/streaming/index.js';
import { generateId } from '../lib/utils.js';

/**
 * Generate a response based on intent and action result
 */
export async function generateResponse(
  userContent: string,
  context: any,
  intent: string,
  action: any,
  actionResult: any
): Promise<string> {
  // For simple chat responses, return the action result directly
  if (action.type === 'CHAT_RESPONSE') {
    return action.content;
  }

  // For clarification, return the clarification question
  if (action.type === 'CLARIFICATION') {
    return action.question;
  }

  // For successful actions, generate a natural response
  if (actionResult.success) {
    return formatSuccessResponse(action, actionResult);
  }

  // For failed actions, generate an error response
  return formatErrorResponse(action, actionResult);
}

/**
 * Generate clarification question when intent is unclear
 */
export async function generateClarification(
  userContent: string,
  context: any,
  classified: any
): Promise<{ question: string; options?: string[] }> {
  // Generate a clarification question based on the ambiguous input
  return {
    question: `I'm not sure what you'd like me to do. Could you clarify? For example, are you looking to: chat, search files, create a task, or start an automated task?`,
    options: ['Chat', 'Search files', 'Create task', 'Start agent task'],
  };
}

/**
 * Format a successful action result into a natural language response
 */
function formatSuccessResponse(action: any, result: any): string {
  switch (action.type) {
    case 'MEMORY_READ':
      const memories = result.data || [];
      if (memories.length === 0) {
        return `I couldn't find any memories matching "${action.query}".`;
      }
      return `I found ${memories.length} relevant memor${memories.length === 1 ? 'y' : 'ies'}: ${memories.slice(0, 3).map((m: any) => m.content).join('; ')}`;
    
    case 'MEMORY_WRITE':
      return `I've saved that to memory: "${action.content}"`;
    
    case 'FILE_OPERATION':
      return `File ${action.operation} completed successfully.`;
    
    case 'OBSIDIAN_OPERATION':
      return `Obsidian ${action.operation} completed successfully.`;
    
    case 'TASK_OPERATION':
      return `Task ${action.operation} completed successfully.`;
    
    case 'AGENT_TASK':
      return `Agent task completed: ${result.data?.runId ? `run ${result.data.runId}` : 'completed'}`;
    
    case 'AGENT_CONTROL':
      return `Agent ${action.operation} completed.`;
    
    case 'SYSTEM_ACTION':
      return `System ${action.action}: ${JSON.stringify(result.data)}`;
    
    default:
      return 'Action completed successfully.';
  }
}

/**
 * Format an error response
 */
function formatErrorResponse(action: any, result: any): string {
  return `I encountered an issue: ${result.error || 'Unknown error'}. ${result.metadata?.suggestions?.join(' ') || 'Please try again.'}`;
}