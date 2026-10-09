/**
 * ORION Memory Store
 * Implements short-term, long-term, and conversation history memory
 */

import type {
  Memory,
  MemoryStore,
  MemoryQueryOptions,
  ConversationMessage,
  ConversationSummary,
  MemoryCategory,
} from '../../types/index.js';
import { stmt, rowToMemory, rowToMessage, now } from '../../database/client.js';
import { generateId } from '../../lib/utils.js';

export class MemoryStoreImpl implements MemoryStore {
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  // Short-term memory (session-scoped, ephemeral)
  async addShortTerm(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    const id = generateId();
    const timestamp = now();

    stmt.addShortTermMemory.run(
      id,
      this.sessionId,
      memory.content,
      memory.category,
      memory.importance,
      timestamp,
      timestamp,
      memory.source,
      JSON.stringify(memory.metadata),
      JSON.stringify(memory.tags),
      memory.conversationId || null
    );

    return {
      ...memory,
      id,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
    };
  }

  async getShortTerm(limit = 50): Promise<Memory[]> {
    const rows = stmt.getShortTermMemories.all(this.sessionId, limit) as any[];
    return rows.map(rowToMemory);
  }

  async clearShortTerm(): Promise<void> {
    stmt.clearShortTermMemories.run(this.sessionId);
  }

  // Long-term memory (persistent across sessions)
  async addLongTerm(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    const id = generateId();
    const timestamp = now();

    stmt.addMemory.run(
      id,
      memory.content,
      memory.category,
      memory.importance,
      timestamp,
      timestamp,
      memory.source,
      JSON.stringify(memory.metadata),
      JSON.stringify(memory.tags),
      memory.conversationId || null,
      memory.embedding ? Buffer.from(new Float32Array(memory.embedding).buffer) : null
    );

    return {
      ...memory,
      id,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
    };
  }

  async getLongTerm(options: MemoryQueryOptions = {}): Promise<Memory[]> {
    const {
      category,
      minImportance,
      tags,
      since,
      until,
      limit = 100,
      offset = 0,
    } = options;

    const rows = stmt.getMemories.all(
      category || null,
      category || null,
      minImportance ?? null,
      minImportance ?? 0,
      tags?.[0] || null,
      tags?.[0] || null,
      since?.getTime() ?? null,
      since?.getTime() ?? 0,
      until?.getTime() ?? null,
      until?.getTime() ?? Date.now(),
      limit,
      offset
    ) as any[];

    return rows.map(rowToMemory);
  }

  async updateLongTerm(id: string, updates: Partial<Memory>): Promise<Memory | null> {
    const existing = stmt.getMemory.get(id) as any;
    if (!existing) return null;

    const updated = { ...existing, ...updates, updated_at: now() };
    
    stmt.updateMemory.run(
      updated.content,
      updated.category,
      updated.importance,
      updated.updated_at,
      JSON.stringify(updated.metadata),
      JSON.stringify(updated.tags),
      id
    );

    return rowToMemory({ ...updated, updated_at: updated.updated_at });
  }

  async deleteLongTerm(id: string): Promise<boolean> {
    const result = stmt.deleteMemory.run(id);
    return result.changes > 0;
  }

  async searchLongTerm(query: string, limit = 20): Promise<Memory[]> {
    const rows = stmt.searchMemories.all(`%${query}%`, limit) as any[];
    return rows.map(rowToMemory);
  }

  // Conversation history
  async addConversationMessage(message: ConversationMessage): Promise<void> {
    stmt.addMessage.run(
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolCallId || null,
      JSON.stringify(message.metadata || {}),
      message.createdAt.getTime()
    );
  }

  async getConversationHistory(conversationId: string, limit = 100): Promise<ConversationMessage[]> {
    const rows = stmt.getMessages.all(conversationId, limit) as any[];
    return rows.map(rowToMessage);
  }

  async getRecentConversations(_limit = 20): Promise<ConversationSummary[]> {
    // This would need a session ID to filter by user's sessions
    // For now, return empty - would be implemented with proper session tracking
    return [];
  }
}

// Factory function
export function createMemoryStore(sessionId: string): MemoryStore {
  return new MemoryStoreImpl(sessionId);
}

// High-level memory utilities
export async function extractMemoriesFromConversation(
  messages: ConversationMessage[],
  sessionId: string,
  options: { minImportance?: number; categories?: MemoryCategory[] } = {}
): Promise<Memory[]> {
  const store = createMemoryStore(sessionId);
  const memories: Memory[] = [];

  // Simple extraction: look for factual statements, preferences, etc.
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;

    // Extract potential memories from content
    const extracted = extractMemoriesFromText(message.content, message.id);
    
    for (const mem of extracted) {
      if (options.minImportance && mem.importance < options.minImportance) continue;
      if (options.categories && !options.categories.includes(mem.category)) continue;

      const memory = await store.addLongTerm({
        ...mem,
        source: 'conversation',
        conversationId: message.conversationId,
        metadata: { ...mem.metadata, extractedFrom: message.id },
      });
      memories.push(memory);
    }
  }

  return memories;
}

function extractMemoriesFromText(text: string, messageId: string): Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>[] {
  const memories: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  
  // Simple pattern matching for common memory types
  const patterns = [
    { pattern: /\b(?:i|my)\s+(?:prefer|like|dislike|hate|love)\s+/i, category: 'preference' as MemoryCategory, importance: 70 },
    { pattern: /\b(?:remember|note|save)\s+(?:that|this)\s+/i, category: 'fact' as MemoryCategory, importance: 80 },
    { pattern: /\b(?:project|repo|repository)\s+(?:is|called|named)\s+/i, category: 'project' as MemoryCategory, importance: 75 },
    { pattern: /\b(?:my|the)\s+(?:password|key|token|secret)\s+/i, category: 'fact' as MemoryCategory, importance: 90 }, // High importance but should be filtered
    { pattern: /\bhow to\s+/i, category: 'procedure' as MemoryCategory, importance: 60 },
  ];

  for (const { pattern, category, importance } of patterns) {
    const matches = text.matchAll(new RegExp(pattern, 'gi'));
    for (const match of matches) {
      // Extract surrounding context (up to 200 chars)
      const start = Math.max(0, match.index! - 50);
      const end = Math.min(text.length, match.index! + match[0].length + 150);
      const content = text.slice(start, end).trim();

      memories.push({
        content,
        category,
        importance,
        source: 'conversation',
        metadata: { extractedFrom: messageId, pattern: pattern.source },
        tags: [category],
      });
    }
  }

  return memories;
}

export async function getRelevantMemories(
  query: string,
  sessionId: string,
  options: { limit?: number; minImportance?: number } = {}
): Promise<Memory[]> {
  const store = createMemoryStore(sessionId);
  const { limit = 10, minImportance = 30 } = options;

  // Search long-term memory
  const longTerm = await store.searchLongTerm(query, limit);

  // Get recent short-term memory
  const shortTerm = await store.getShortTerm(limit);

  // Combine and deduplicate
  const all = [...longTerm, ...shortTerm];
  const unique = new Map<string, Memory>();
  
  for (const mem of all) {
    if (mem.importance >= minImportance) {
      unique.set(mem.id, mem);
    }
  }

  return Array.from(unique.values())
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit);
}