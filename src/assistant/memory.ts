/**
 * ORION Assistant Memory Integration
 * Handles memory retrieval and storage for the assistant
 */

import type {
  AssistantContext,
} from '../types/assistant.js';

/**
 * Load relevant memory for a given query
 */
export async function loadRelevantMemory(
  query: string,
  context: AssistantContext,
  limit = 10
): Promise<any[]> {
  const memoryStore = context.memoryStoreFactory?.(context.session.sessionId);
  if (!memoryStore) return [];
  
  const memories = await memoryStore.searchLongTerm(query, limit);
  return memories;
}

/**
 * Build conversation context from memory
 */
export async function buildConversationContext(
  context: AssistantContext,
  maxMessages = 50
): Promise<any[]> {
  const memoryStore = context.memoryStoreFactory?.(context.session.sessionId);
  if (!memoryStore) return [];
  
  const conversationHistory = await memoryStore.getConversationHistory(
    context.conversation.id,
    maxMessages
  );
  
  return conversationHistory.map((msg: any) => ({
    role: msg.role,
    content: msg.content,
    toolCalls: msg.toolCalls,
    toolCallId: msg.toolCallId,
    createdAt: msg.createdAt,
  }));
}

/**
 * Execute memory read action
 */
export async function executeMemoryRead(
  action: any,
  context: AssistantContext
): Promise<any> {
  const memoryStore = context.memoryStoreFactory?.(context.session.sessionId);
  if (!memoryStore) return { success: false, error: 'Memory store not available' };
  
  const memories = await memoryStore.searchLongTerm(action.query, action.limit || 10);
  
  return { success: true, data: memories };
}

/**
 * Execute memory write action
 */
export async function executeMemoryWrite(
  action: any,
  context: AssistantContext
): Promise<any> {
  const memoryStore = context.memoryStoreFactory?.(context.session.sessionId);
  if (!memoryStore) return { success: false, error: 'Memory store not available' };
  
  const memory = await memoryStore.addLongTerm({
    content: action.content,
    category: action.category,
    importance: action.importance || 50,
    source: 'explicit',
    metadata: {},
    tags: action.tags || [],
    conversationId: context.conversation.id,
  });

  return { success: true, data: memory };
}