// ---------------------------------------------------------------------------
// Types (mirrors src/db/types.ts)
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

export interface RunWithDetails extends Run {
  agent_outputs: AgentOutput[];
  review: Review | null;
}

export interface QueueResponse {
  pending: Run[];
  running: Run[];
  counts: { pending: number; running: number };
}

export interface RunsFilters {
  status?: RunStatus;
  repo?: string;
  since?: string;
}

// ---------------------------------------------------------------------------
// Credential management
// ---------------------------------------------------------------------------

const CRED_KEY = 'reviewer_credentials';

export interface Credentials {
  username: string;
  password: string;
}

export function saveCredentials(creds: Credentials): void {
  localStorage.setItem(CRED_KEY, JSON.stringify(creds));
}

export function loadCredentials(): Credentials | null {
  const raw = localStorage.getItem(CRED_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  localStorage.removeItem(CRED_KEY);
}

function basicAuthHeader(creds: Credentials): string {
  return 'Basic ' + btoa(`${creds.username}:${creds.password}`);
}

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

async function fetchApi<T>(path: string, creds: Credentials | null): Promise<T> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (creds) {
    headers['Authorization'] = basicAuthHeader(creds);
  }

  const res = await fetch(path, { headers });

  if (res.status === 401) {
    clearCredentials();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Typed API helpers
// ---------------------------------------------------------------------------

export function getQueue(creds: Credentials | null): Promise<QueueResponse> {
  return fetchApi<QueueResponse>('/api/queue', creds);
}

export function getRuns(creds: Credentials | null, filters?: RunsFilters): Promise<Run[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.repo) params.set('repo', filters.repo);
  if (filters?.since) params.set('since', filters.since);
  const qs = params.toString();
  return fetchApi<Run[]>(`/api/runs${qs ? `?${qs}` : ''}`, creds);
}

export function getRunDetail(creds: Credentials | null, id: string): Promise<RunWithDetails> {
  return fetchApi<RunWithDetails>(`/api/runs/${id}`, creds);
}

export function getConfig(creds: Credentials | null): Promise<unknown> {
  return fetchApi<unknown>('/api/config', creds);
}
