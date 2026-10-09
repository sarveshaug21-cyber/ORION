/**
 * ORION Agent Runtime Database Schema
 * Tables for agent run and step persistence
 */

export const AGENT_SCHEMA = `
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
  initial_context TEXT,              -- JSON: compact context metadata
  limits TEXT NOT NULL,              -- JSON: AgentRunLimits
  current_step_index INTEGER NOT NULL DEFAULT 0,
  total_tokens_used INTEGER NOT NULL DEFAULT 0,
  final_answer TEXT,
  final_error TEXT,                  -- JSON: AgentError
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
  model_input TEXT,                  -- JSON: compact model input metadata
  model_output TEXT,                 -- JSON: compact model output metadata
  tool_calls TEXT,                   -- JSON: ToolCall[]
  tool_results TEXT,                 -- JSON: {toolCall, result}[]
  observation TEXT,
  error TEXT,                        -- JSON: AgentError
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
`;

/**
 * Create the agent schema in the database
 */
export function createAgentSchema(db: any): void {
  db.exec(AGENT_SCHEMA);
}