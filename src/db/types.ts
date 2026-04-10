// ---------------------------------------------------------------------------
// Database entity types
// ---------------------------------------------------------------------------

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type AgentType = 'codex' | 'claude';

export type MemoryRole = 'user' | 'assistant' | 'tool';

export interface Run {
  id: string;
  pr_url: string;
  pr_number: number;
  repo: string;
  trigger_comment_id: number;
  trigger_user: string;
  trigger_body: string;
  status: RunStatus;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  timeout_minutes: number;
  cost_usd: number | null;
  total_tokens: number | null;
}

export interface AgentOutput {
  id: string;
  run_id: string;
  agent_type: AgentType;
  prompt: string;
  raw_output: string | null;
  duration_ms: number | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  created_at: string;
}

export interface InlineComment {
  path: string;
  line: number;
  body: string;
  side?: 'LEFT' | 'RIGHT';
}

export interface Review {
  id: string;
  run_id: string;
  summary: string;
  inline_comments: string; // JSON-serialised InlineComment[]
  comment_id: number | null;
  comment_url: string | null;
  created_at: string;
}

export interface ConversationMemory {
  id: string;
  pr_url: string;
  role: MemoryRole;
  content: string;
  tool_name: string | null;
  tool_result: string | null;
  run_id: string | null;
  created_at: string;
}

export interface RunStep {
  id: string;
  run_id: string;
  step_number: number;
  tool_calls: string; // JSON: [{toolName, args, result}]
  usage_input: number | null;
  usage_output: number | null;
  created_at: string;
}

export interface RunWithDetails extends Run {
  agent_outputs: AgentOutput[];
  review: Review | null;
  steps: RunStep[];
}
