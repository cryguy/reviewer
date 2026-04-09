import type { Database } from 'bun:sqlite';

// ---------------------------------------------------------------------------
// Table DDL
// ---------------------------------------------------------------------------

const CREATE_RUNS = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  pr_url TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  repo TEXT NOT NULL,
  trigger_comment_id INTEGER NOT NULL,
  trigger_user TEXT NOT NULL,
  trigger_body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  timeout_minutes INTEGER NOT NULL DEFAULT 15,
  cost_usd REAL,
  total_tokens INTEGER
)`;

const CREATE_AGENT_OUTPUTS = `
CREATE TABLE IF NOT EXISTS agent_outputs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  agent_type TEXT NOT NULL CHECK(agent_type IN ('codex', 'claude')),
  prompt TEXT NOT NULL,
  raw_output TEXT,
  duration_ms INTEGER,
  tokens_prompt INTEGER,
  tokens_completion INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const CREATE_REVIEWS = `
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  summary TEXT NOT NULL,
  inline_comments TEXT NOT NULL,
  comment_id INTEGER,
  comment_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const CREATE_CONVERSATION_MEMORY = `
CREATE TABLE IF NOT EXISTS conversation_memory (
  id TEXT PRIMARY KEY,
  pr_url TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_result TEXT,
  run_id TEXT REFERENCES runs(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const CREATE_KV = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

// ---------------------------------------------------------------------------
// Index DDL
// ---------------------------------------------------------------------------

const INDICES = [
  `CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_pr ON runs(pr_url)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_pr ON conversation_memory(pr_url, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_run ON conversation_memory(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_outputs_run ON agent_outputs(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_run ON reviews(run_id)`,
];

// ---------------------------------------------------------------------------
// Initialiser
// ---------------------------------------------------------------------------

export function initializeDatabase(db: Database): void {
  db.run(CREATE_RUNS);
  db.run(CREATE_AGENT_OUTPUTS);
  db.run(CREATE_REVIEWS);
  db.run(CREATE_CONVERSATION_MEMORY);
  db.run(CREATE_KV);

  for (const idx of INDICES) {
    db.run(idx);
  }
}
