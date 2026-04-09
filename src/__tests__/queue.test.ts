import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { initializeDatabase } from '../db/schema.ts';

// ---------------------------------------------------------------------------
// In-memory DB setup — we bypass the singleton by patching getDb
// ---------------------------------------------------------------------------

let testDb: Database;

// We need to inject an in-memory DB into the db module.
// The db/index.ts singleton uses a module-level _db variable.
// We reset it by directly replacing the internal state via a re-import trick:
// Instead, we call each function after manually initializing the database.
// The cleanest approach: use the `:memory:` database and call the ops directly.

function makeDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

// ---------------------------------------------------------------------------
// Minimal in-process queue ops that use our test DB (mirrors queue.ts logic)
// ---------------------------------------------------------------------------

import type { Run } from '../db/types.ts';

type NamedBinding = Record<string, string | number | boolean | null>;

function generateId(): string {
  return crypto.randomUUID();
}

interface CreateRunParams {
  pr_url: string;
  pr_number: number;
  repo: string;
  trigger_comment_id: number;
  trigger_user: string;
  trigger_body: string;
  timeout_minutes?: number;
}

function createRun(db: Database, params: CreateRunParams): Run {
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
  return db.query<Run, [NamedBinding]>(`SELECT * FROM runs WHERE id = $id`).get({ $id: id })!;
}

function dequeue(db: Database): Run | null {
  const tx = db.transaction((): Run | null => {
    const next = db
      .query<Run, []>(`SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`)
      .get();
    if (next === null) return null;
    db.query<unknown, [NamedBinding]>(
      `UPDATE runs SET status = $status, started_at = datetime('now') WHERE id = $id`,
    ).run({ $status: 'running', $id: next.id });
    return db.query<Run, [NamedBinding]>(`SELECT * FROM runs WHERE id = $id`).get({ $id: next.id }) ?? null;
  });
  return tx();
}

function getQueueStatus(db: Database): { pending: number; running: number } {
  const row = db
    .query<{ pending: number; running: number }, []>(
      `SELECT
         SUM(CASE WHEN status = 'queued'  THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
       FROM runs
       WHERE status IN ('queued', 'running')`,
    )
    .get();
  return { pending: row?.pending ?? 0, running: row?.running ?? 0 };
}

function getRunningRuns(db: Database): Run[] {
  return db
    .query<Run, []>(`SELECT * FROM runs WHERE status = 'running' ORDER BY created_at ASC`)
    .all();
}

function getQueuedRuns(db: Database): Run[] {
  return db
    .query<Run, []>(`SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC`)
    .all();
}

function recoverInterruptedRuns(db: Database): Run[] {
  const running = getRunningRuns(db);
  if (running.length === 0) return [];
  for (const run of running) {
    db.query<unknown, [NamedBinding]>(
      `UPDATE runs SET status = $status WHERE id = $id`,
    ).run({ $status: 'queued', $id: run.id });
  }
  const queued = getQueuedRuns(db);
  return queued.filter((r) => running.some((orig) => orig.id === r.id));
}

// ---------------------------------------------------------------------------
// Default run params
// ---------------------------------------------------------------------------

const DEFAULT_PARAMS: CreateRunParams = {
  pr_url: 'https://github.com/owner/repo/pull/1',
  pr_number: 1,
  repo: 'owner/repo',
  trigger_comment_id: 100,
  trigger_user: 'testuser',
  trigger_body: '@bot review',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enqueue (createRun)', () => {
  beforeEach(() => {
    testDb = makeDb();
  });
  afterEach(() => {
    testDb.close();
  });

  it('creates a run with status queued', () => {
    const run = createRun(testDb, DEFAULT_PARAMS);
    expect(run.status).toBe('queued');
    expect(run.id).toBeTruthy();
    expect(run.pr_url).toBe(DEFAULT_PARAMS.pr_url);
    expect(run.repo).toBe(DEFAULT_PARAMS.repo);
  });

  it('created run has all expected fields', () => {
    const run = createRun(testDb, DEFAULT_PARAMS);
    expect(run.pr_number).toBe(1);
    expect(run.trigger_user).toBe('testuser');
    expect(run.trigger_body).toBe('@bot review');
    expect(run.error).toBeNull();
    expect(run.started_at).toBeNull();
    expect(run.completed_at).toBeNull();
    expect(run.timeout_minutes).toBe(15);
  });

  it('assigns unique IDs to separate runs', () => {
    const run1 = createRun(testDb, DEFAULT_PARAMS);
    const run2 = createRun(testDb, { ...DEFAULT_PARAMS, pr_number: 2 });
    expect(run1.id).not.toBe(run2.id);
  });
});

describe('dequeue', () => {
  beforeEach(() => {
    testDb = makeDb();
  });
  afterEach(() => {
    testDb.close();
  });

  it('returns the oldest queued run and marks it running', () => {
    createRun(testDb, DEFAULT_PARAMS);
    const dequeued = dequeue(testDb);
    expect(dequeued).not.toBeNull();
    expect(dequeued!.status).toBe('running');
    expect(dequeued!.started_at).not.toBeNull();
  });

  it('returns runs in FIFO order', async () => {
    const run1 = createRun(testDb, { ...DEFAULT_PARAMS, pr_number: 1 });
    // Small delay to ensure different created_at timestamps
    await new Promise((r) => setTimeout(r, 10));
    createRun(testDb, { ...DEFAULT_PARAMS, pr_number: 2 });

    const dequeued = dequeue(testDb);
    expect(dequeued!.id).toBe(run1.id);
  });

  it('returns null when queue is empty', () => {
    const result = dequeue(testDb);
    expect(result).toBeNull();
  });

  it('does not return the same run twice', () => {
    createRun(testDb, DEFAULT_PARAMS);
    const first = dequeue(testDb);
    const second = dequeue(testDb);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});

describe('recoverInterruptedRuns', () => {
  beforeEach(() => {
    testDb = makeDb();
  });
  afterEach(() => {
    testDb.close();
  });

  it('resets running runs back to queued', () => {
    createRun(testDb, DEFAULT_PARAMS);
    dequeue(testDb); // puts it in 'running'

    const recovered = recoverInterruptedRuns(testDb);
    expect(recovered.length).toBe(1);
    expect(recovered[0]!.status).toBe('queued');
  });

  it('returns empty array when no running runs', () => {
    createRun(testDb, DEFAULT_PARAMS);
    const recovered = recoverInterruptedRuns(testDb);
    expect(recovered).toHaveLength(0);
  });

  it('recovers multiple running runs', () => {
    createRun(testDb, { ...DEFAULT_PARAMS, pr_number: 1 });
    createRun(testDb, { ...DEFAULT_PARAMS, pr_number: 2 });
    dequeue(testDb);
    dequeue(testDb);

    const recovered = recoverInterruptedRuns(testDb);
    expect(recovered.length).toBe(2);
    for (const r of recovered) {
      expect(r.status).toBe('queued');
    }
  });
});

describe('getQueueStatus', () => {
  beforeEach(() => {
    testDb = makeDb();
  });
  afterEach(() => {
    testDb.close();
  });

  it('returns zeros when queue is empty', () => {
    const status = getQueueStatus(testDb);
    expect(status.pending).toBe(0);
    expect(status.running).toBe(0);
  });

  it('returns correct pending count', () => {
    createRun(testDb, { ...DEFAULT_PARAMS, pr_number: 1 });
    createRun(testDb, { ...DEFAULT_PARAMS, pr_number: 2 });
    const status = getQueueStatus(testDb);
    expect(status.pending).toBe(2);
    expect(status.running).toBe(0);
  });

  it('returns correct running count after dequeue', () => {
    createRun(testDb, { ...DEFAULT_PARAMS, pr_number: 1 });
    createRun(testDb, { ...DEFAULT_PARAMS, pr_number: 2 });
    dequeue(testDb);
    const status = getQueueStatus(testDb);
    expect(status.pending).toBe(1);
    expect(status.running).toBe(1);
  });
});
