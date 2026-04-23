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
  total_tokens INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  merged_comment_ids TEXT NOT NULL DEFAULT '[]',
  system_prompt TEXT,
  orchestrator_input TEXT,
  orchestrator_model TEXT
)`;

const CREATE_AGENT_OUTPUTS = `
CREATE TABLE IF NOT EXISTS agent_outputs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  attempt INTEGER NOT NULL DEFAULT 1,
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
  attempt INTEGER NOT NULL DEFAULT 1,
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

const CREATE_RUN_STEPS = `
CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  attempt INTEGER NOT NULL DEFAULT 1,
  step_number INTEGER NOT NULL,
  tool_calls TEXT NOT NULL DEFAULT '[]',
  usage_input INTEGER,
  usage_output INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  assistant_text TEXT,
  reasoning TEXT,
  stop_reason TEXT
)`;

const CREATE_RUN_EVENTS = `
CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  attempt INTEGER NOT NULL DEFAULT 1,
  event_type TEXT NOT NULL,
  phase TEXT,
  message TEXT,
  metadata TEXT DEFAULT '{}',
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
  `CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, attempt, created_at)`,
];

// ---------------------------------------------------------------------------
// Initialiser
// ---------------------------------------------------------------------------

export function initializeDatabase(db: Database): void {
  db.run(CREATE_RUNS);
  db.run(CREATE_AGENT_OUTPUTS);
  db.run(CREATE_REVIEWS);
  db.run(CREATE_CONVERSATION_MEMORY);
  db.run(CREATE_RUN_STEPS);
  db.run(CREATE_RUN_EVENTS);
  db.run(CREATE_KV);

  // Migrate existing databases: add attempt columns if missing.
  // SQLite lacks ADD COLUMN IF NOT EXISTS, so we catch duplicate-column errors.
  const migrations = [
    `ALTER TABLE runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE run_steps ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE agent_outputs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE reviews ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE runs ADD COLUMN merged_comment_ids TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE runs ADD COLUMN system_prompt TEXT`,
    `ALTER TABLE runs ADD COLUMN orchestrator_input TEXT`,
    `ALTER TABLE runs ADD COLUMN orchestrator_model TEXT`,
    `ALTER TABLE run_steps ADD COLUMN assistant_text TEXT`,
    `ALTER TABLE run_steps ADD COLUMN reasoning TEXT`,
    `ALTER TABLE run_steps ADD COLUMN stop_reason TEXT`,
  ];
  for (const sql of migrations) {
    try { db.run(sql); } catch { /* column already exists */ }
  }

  for (const idx of INDICES) {
    db.run(idx);
  }
}
