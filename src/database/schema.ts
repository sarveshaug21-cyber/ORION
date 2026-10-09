/**
 * ORION Database Schema
 * SQLite schema for persistent storage
 */

export const SCHEMA = `
-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  working_directory TEXT NOT NULL,
  active_conversation_id TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  metadata TEXT NOT NULL DEFAULT '{}'
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_call_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Long-term memories table
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('fact', 'preference', 'context', 'procedure', 'project', 'contact', 'custom')),
  importance INTEGER NOT NULL DEFAULT 50 CHECK (importance >= 0 AND importance <= 100),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('conversation', 'explicit', 'tool_result', 'observation', 'import')),
  metadata TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  conversation_id TEXT,
  embedding BLOB
);

-- Short-term memories table (session-scoped)
CREATE TABLE IF NOT EXISTS short_term_memories (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('fact', 'preference', 'context', 'procedure', 'project', 'contact', 'custom')),
  importance INTEGER NOT NULL DEFAULT 50 CHECK (importance >= 0 AND importance <= 100),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('conversation', 'explicit', 'tool_result', 'observation', 'import')),
  metadata TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  conversation_id TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Skills table
CREATE TABLE IF NOT EXISTS skills (
  name TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  description TEXT NOT NULL,
  author TEXT,
  license TEXT,
  homepage TEXT,
  repository TEXT,
  keywords TEXT NOT NULL DEFAULT '[]',
  min_orion_version TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  config_schema TEXT,
  default_config TEXT NOT NULL DEFAULT '{}',
  config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  loaded_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Tool call history table
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'awaiting_permission')),
  result TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  permission_requested INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Activity log table
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('voice_input', 'understanding', 'tool_call', 'tool_result', 'thinking', 'response', 'error', 'permission_request')),
  timestamp INTEGER NOT NULL,
  message TEXT NOT NULL,
  data TEXT,
  level TEXT NOT NULL CHECK (level IN ('info', 'success', 'warning', 'error')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);
CREATE INDEX IF NOT EXISTS idx_short_term_memories_session ON short_term_memories(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation ON tool_calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_session ON activity_log(session_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
`;

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    up: `
-- Agent runs table
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'CREATED','PLANNING','REASONING','ACTING','EXECUTING','OBSERVING',
    'COMPLETED','FAILED','CANCELLED'
  )),
  goal TEXT NOT NULL,
  initial_context TEXT,
  limits TEXT NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  total_tokens_used INTEGER NOT NULL DEFAULT 0,
  final_answer TEXT,
  final_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Agent steps table
CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  plan TEXT,
  model_input TEXT,
  model_output TEXT,
  tool_calls TEXT,
  tool_results TEXT,
  observation TEXT,
  error TEXT,
  tokens_prompt INTEGER,
  tokens_completion INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation ON agent_runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run_index ON agent_steps(run_id, step_index);
    `,
    down: `
DROP INDEX IF EXISTS idx_agent_steps_run_index;
DROP INDEX IF EXISTS idx_agent_steps_run;
DROP INDEX IF EXISTS idx_agent_runs_status;
DROP INDEX IF EXISTS idx_agent_runs_conversation;
DROP INDEX IF EXISTS idx_agent_runs_session;
DROP TABLE IF EXISTS agent_steps;
DROP TABLE IF EXISTS agent_runs;
    `
  },
  // Add future migrations here as needed
  // Example:
  // {
  //   version: 3,
  //   up: `ALTER TABLE memories ADD COLUMN embedding_model TEXT;`,
  //   down: `ALTER TABLE memories DROP COLUMN embedding_model;`
  // }
];

export type Migration = {
  version: number;
  up: string;
  down: string;
};