import { getDb, generateId } from './index.ts';
import type { Run, AgentOutput, Review, RunStep, RunStatus, RunWithDetails } from './types.ts';
import { logger } from '../logger.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateRunParams {
  pr_url: string;
  pr_number: number;
  repo: string;
  trigger_comment_id: number;
  trigger_user: string;
  trigger_body: string;
  timeout_minutes?: number;
}

export interface ListRunsFilters {
  status?: RunStatus;
  repo?: string;
  since?: string; // ISO datetime string
}

export interface UpdateRunStatusExtra {
  error?: string;
  cost_usd?: number;
  total_tokens?: number;
}

type NamedBinding = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createRun(params: CreateRunParams): Run {
  const db = getDb();
  const id = generateId();

  db.query<unknown, [NamedBinding]>(
    `INSERT INTO runs (id, pr_url, pr_number, repo, trigger_comment_id, trigger_user, trigger_body, status, timeout_minutes)
     VALUES ($id, $pr_url, $pr_number, $repo, $trigger_comment_id, $trigger_user, $trigger_body, 'queued', $timeout_minutes)`,
  ).run({
    $id: id,
    $pr_url: params.pr_url,
    $pr_number: params.pr_number,
    $repo: params.repo,
    $trigger_comment_id: params.trigger_comment_id,
    $trigger_user: params.trigger_user,
    $trigger_body: params.trigger_body,
    $timeout_minutes: params.timeout_minutes ?? 15,
  });

  const run = getRun(id);
  if (run === null) {
    throw new Error(`Failed to retrieve run after insert: ${id}`);
  }
  return run;
}

export function getRun(id: string): Run | null {
  const db = getDb();
  return (
    db
      .query<Run, [NamedBinding]>(`SELECT * FROM runs WHERE id = $id`)
      .get({ $id: id }) ?? null
  );
}

export function getRunWithDetails(id: string): RunWithDetails | null {
  const db = getDb();

  const run = getRun(id);
  if (run === null) {
    return null;
  }

  const agent_outputs = db
    .query<AgentOutput, [NamedBinding]>(
      `SELECT * FROM agent_outputs WHERE run_id = $run_id ORDER BY created_at ASC`,
    )
    .all({ $run_id: id });

  const review =
    db
      .query<Review, [NamedBinding]>(
        `SELECT * FROM reviews WHERE run_id = $run_id ORDER BY created_at DESC LIMIT 1`,
      )
      .get({ $run_id: id }) ?? null;

  const steps = db
    .query<RunStep, [NamedBinding]>(
      `SELECT * FROM run_steps WHERE run_id = $run_id ORDER BY step_number ASC`,
    )
    .all({ $run_id: id });

  return { ...run, agent_outputs, review, steps };
}

export function insertRunStep(
  runId: string,
  stepNumber: number,
  toolCalls: Array<{ toolName: string; args: unknown; result?: unknown }>,
  usageInput: number | null,
  usageOutput: number | null,
): void {
  const db = getDb();
  db.query(
    `INSERT INTO run_steps (id, run_id, step_number, tool_calls, usage_input, usage_output)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    runId,
    stepNumber,
    JSON.stringify(toolCalls),
    usageInput,
    usageOutput,
  );
}

export function listRuns(filters?: ListRunsFilters): Run[] {
  const db = getDb();

  const conditions: string[] = [];
  const bindings: NamedBinding = {};

  if (filters?.status !== undefined) {
    conditions.push('status = $status');
    bindings['$status'] = filters.status;
  }
  if (filters?.repo !== undefined) {
    conditions.push('repo = $repo');
    bindings['$repo'] = filters.repo;
  }
  if (filters?.since !== undefined) {
    conditions.push('created_at >= $since');
    bindings['$since'] = filters.since;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM runs ${where} ORDER BY created_at DESC`;

  return db.query<Run, [NamedBinding]>(sql).all(bindings);
}

export function updateRunStatus(
  id: string,
  status: RunStatus,
  extra?: UpdateRunStatusExtra,
): void {
  const db = getDb();

  const setClauses: string[] = ['status = $status'];
  const bindings: NamedBinding = {
    $id: id,
    $status: status,
  };

  if (status === 'running') {
    setClauses.push("started_at = datetime('now')");
  }
  if (status === 'completed' || status === 'failed') {
    setClauses.push("completed_at = datetime('now')");
  }

  if (extra?.error !== undefined) {
    setClauses.push('error = $error');
    bindings['$error'] = extra.error;
  }
  if (extra?.cost_usd !== undefined) {
    setClauses.push('cost_usd = $cost_usd');
    bindings['$cost_usd'] = extra.cost_usd;
  }
  if (extra?.total_tokens !== undefined) {
    setClauses.push('total_tokens = $total_tokens');
    bindings['$total_tokens'] = extra.total_tokens;
  }

  const sql = `UPDATE runs SET ${setClauses.join(', ')} WHERE id = $id`;

  try {
    db.query<unknown, [NamedBinding]>(sql).run(bindings);
  } catch (err) {
    logger.error('updateRunStatus failed', { id, status, err: String(err) });
    throw err;
  }
}

export function getQueuedRuns(): Run[] {
  const db = getDb();
  return db
    .query<Run, []>(
      `SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC`,
    )
    .all();
}

export function getRunningRuns(): Run[] {
  const db = getDb();
  return db
    .query<Run, []>(
      `SELECT * FROM runs WHERE status = 'running' ORDER BY created_at ASC`,
    )
    .all();
}
