/**
 * ORION Database Client
 * SQLite wrapper with type-safe queries
 */

import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database, Statement as BetterSqlite3Statement, Transaction as BetterSqlite3Transaction } from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { SCHEMA } from './schema.js';
import type { Memory, ConversationMessage, Session, Conversation, ToolCall, AIActivity } from '../types/index.js';

const DB_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DB_DIR, 'orion.db');

if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

export const db: BetterSqlite3Database = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Initialize schema
db.exec(SCHEMA);

// Helper functions
function now(): number {
  return Date.now();
}

function rowToMemory(row: any): Memory {
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    importance: row.importance,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    source: row.source,
    metadata: JSON.parse(row.metadata || '{}'),
    tags: JSON.parse(row.tags || '[]'),
    conversationId: row.conversation_id,
    embedding: row.embedding ? Array.from(new Float32Array(row.embedding)) : undefined,
  };
}

function rowToMessage(row: any): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    toolCallId: row.tool_call_id,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: new Date(row.created_at),
  };
}

function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    messageCount: row.message_count,
    metadata: JSON.parse(row.metadata || '{}'),
  };
}

function rowToSession(row: any): Session {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    workingDirectory: row.working_directory,
    activeConversationId: row.active_conversation_id,
    config: JSON.parse(row.config || '{}'),
    metadata: JSON.parse(row.metadata || '{}'),
  };
}

function rowToToolCall(row: any): ToolCall {
  return {
    id: row.id,
    toolName: row.tool_name,
    arguments: JSON.parse(row.arguments || '{}'),
    status: row.status,
    result: row.result ? JSON.parse(row.result) : undefined,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    permissionRequested: Boolean(row.permission_requested),
  };
}

function rowToActivity(row: any): AIActivity {
  return {
    id: row.id,
    type: row.type,
    timestamp: new Date(row.timestamp),
    message: row.message,
    data: row.data ? JSON.parse(row.data) : undefined,
    level: row.level,
  };
}

// Prepared statements
const stmt: Record<string, BetterSqlite3Statement> = {
  // Sessions
  createSession: db.prepare(`
    INSERT INTO sessions (id, user_id, created_at, updated_at, working_directory, config, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getSession: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
  getSessionByUser: db.prepare(`SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`),
  updateSession: db.prepare(`
    UPDATE sessions SET updated_at = ?, working_directory = ?, active_conversation_id = ?, config = ?, metadata = ?
    WHERE id = ?
  `),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),

  // Conversations
  createConversation: db.prepare(`
    INSERT INTO conversations (id, session_id, title, created_at, updated_at, message_count, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getConversation: db.prepare(`SELECT * FROM conversations WHERE id = ?`),
  getConversationsBySession: db.prepare(`
    SELECT * FROM conversations WHERE session_id = ? ORDER BY updated_at DESC LIMIT ?
  `),
  updateConversation: db.prepare(`
    UPDATE conversations SET updated_at = ?, title = ?, message_count = ?, metadata = ? WHERE id = ?
  `),
  incrementConversationMessages: db.prepare(`
    UPDATE conversations SET updated_at = ?, message_count = message_count + 1 WHERE id = ?
  `),
  deleteConversation: db.prepare(`DELETE FROM conversations WHERE id = ?`),

  // Messages
  addMessage: db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getMessages: db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?
  `),
  getRecentMessages: db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
  `),
  updateMessage: db.prepare(`
    UPDATE messages SET content = ?, tool_calls = ?, metadata = ? WHERE id = ?
  `),
  deleteMessagesByConversation: db.prepare(`DELETE FROM messages WHERE conversation_id = ?`),

  // Long-term memories
  addMemory: db.prepare(`
    INSERT INTO memories (id, content, category, importance, created_at, updated_at, source, metadata, tags, conversation_id, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getMemory: db.prepare(`SELECT * FROM memories WHERE id = ?`),
  getMemories: db.prepare(`
    SELECT * FROM memories
    WHERE (? IS NULL OR category = ?)
    AND (? IS NULL OR importance >= ?)
    AND (? IS NULL OR tags LIKE '%' || ? || '%')
    AND (? IS NULL OR created_at >= ?)
    AND (? IS NULL OR created_at <= ?)
    ORDER BY importance DESC, created_at DESC
    LIMIT ? OFFSET ?
  `),
  updateMemory: db.prepare(`
    UPDATE memories SET content = ?, category = ?, importance = ?, updated_at = ?, metadata = ?, tags = ?
    WHERE id = ?
  `),
  deleteMemory: db.prepare(`DELETE FROM memories WHERE id = ?`),
  searchMemories: db.prepare(`
    SELECT * FROM memories
    WHERE content LIKE ?
    ORDER BY importance DESC, created_at DESC
    LIMIT ?
  `),
  getAllMemories: db.prepare(`SELECT * FROM memories ORDER BY importance DESC, created_at DESC`),

  // Short-term memories
  addShortTermMemory: db.prepare(`
    INSERT INTO short_term_memories (id, session_id, content, category, importance, created_at, updated_at, source, metadata, tags, conversation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getShortTermMemories: db.prepare(`
    SELECT * FROM short_term_memories WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
  `),
  clearShortTermMemories: db.prepare(`DELETE FROM short_term_memories WHERE session_id = ?`),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),
  getAllSettings: db.prepare(`SELECT key, value FROM settings`),

  // Skills
  upsertSkill: db.prepare(`
    INSERT INTO skills (name, version, description, author, license, homepage, repository, keywords, min_orion_version, dependencies, config_schema, default_config, config, enabled, loaded_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      version = excluded.version,
      description = excluded.description,
      author = excluded.author,
      license = excluded.license,
      homepage = excluded.homepage,
      repository = excluded.repository,
      keywords = excluded.keywords,
      min_orion_version = excluded.min_orion_version,
      dependencies = excluded.dependencies,
      config_schema = excluded.config_schema,
      default_config = excluded.default_config,
      config = excluded.config,
      enabled = excluded.enabled,
      loaded_at = excluded.loaded_at
  `),
  getSkill: db.prepare(`SELECT * FROM skills WHERE name = ?`),
  getAllSkills: db.prepare(`SELECT * FROM skills WHERE enabled = 1`),
  disableSkill: db.prepare(`UPDATE skills SET enabled = 0 WHERE name = ?`),
  enableSkill: db.prepare(`UPDATE skills SET enabled = 1 WHERE name = ?`),
  deleteSkill: db.prepare(`DELETE FROM skills WHERE name = ?`),

  // Tool calls
  addToolCall: db.prepare(`
    INSERT INTO tool_calls (id, session_id, conversation_id, tool_name, arguments, status, started_at, permission_requested)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateToolCall: db.prepare(`
    UPDATE tool_calls SET status = ?, result = ?, completed_at = ? WHERE id = ?
  `),
  setToolCallResult: db.prepare(`UPDATE tool_calls SET result = ? WHERE id = ?`),
  setToolCallStarted: db.prepare(`
    UPDATE tool_calls SET status = 'executing', started_at = ?, result = NULL, completed_at = NULL WHERE id = ?
  `),
  setToolCallPermissionRequired: db.prepare(`
    UPDATE tool_calls SET status = 'awaiting_permission', permission_requested = 1 WHERE id = ?
  `),
  getToolCallsBySession: db.prepare(`SELECT * FROM tool_calls WHERE session_id = ? ORDER BY started_at DESC LIMIT ?`),
  getToolCallsByConversation: db.prepare(`SELECT * FROM tool_calls WHERE conversation_id = ? ORDER BY started_at ASC`),

  // Activity log
  addActivity: db.prepare(`
    INSERT INTO activity_log (id, session_id, type, timestamp, message, data, level)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getActivitiesBySession: db.prepare(`SELECT * FROM activity_log WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`),
  clearOldActivities: db.prepare(`DELETE FROM activity_log WHERE session_id = ? AND timestamp < ?`),
};

// Transaction helpers
export const transaction: Record<string, BetterSqlite3Transaction> = {
  createSessionWithConversation: db.transaction((session: Session, conversation: Conversation) => {
    stmt.createSession.run(
      session.id,
      session.userId,
      session.createdAt.getTime(),
      session.updatedAt.getTime(),
      session.workingDirectory,
      JSON.stringify(session.config),
      JSON.stringify(session.metadata)
    );
    stmt.createConversation.run(
      conversation.id,
      conversation.sessionId,
      conversation.title,
      conversation.createdAt.getTime(),
      conversation.updatedAt.getTime(),
      conversation.messageCount,
      JSON.stringify(conversation.metadata)
    );
  }),

  addMessageAndUpdateConversation: db.transaction((message: ConversationMessage, conversationId: string, messageCount: number) => {
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
    stmt.updateConversation.run(now(), null, messageCount, '{}', conversationId);
  }),
};

// Export database instance and helpers
export { db as default, now, rowToMemory, rowToMessage, rowToConversation, rowToSession, rowToToolCall, rowToActivity, stmt };