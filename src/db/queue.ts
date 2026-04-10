import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDb } from './index.ts';
import { createRun, getQueuedRuns, getRunningRuns, updateRunStatus } from './runs.ts';
import type { Run } from './types.ts';
import type { CreateRunParams } from './runs.ts';
import { logger } from '../logger.ts';

type NamedBinding = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export function enqueue(params: CreateRunParams): Run {
  return createRun(params);
}

export function dequeue(): Run | null {
  const db = getDb();

  // Use a transaction to atomically fetch + mark as running
  const tx = db.transaction((): Run | null => {
    const next = db
      .query<Run, []>(
        `SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
      )
      .get();

    if (next === null) {
      return null;
    }

    updateRunStatus(next.id, 'running');

    return (
      db
        .query<Run, [NamedBinding]>(`SELECT * FROM runs WHERE id = $id`)
        .get({ $id: next.id }) ?? null
    );
  });

  return tx();
}

export function peek(): Run | null {
  const db = getDb();
  return (
    db
      .query<Run, []>(
        `SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
      )
      .get() ?? null
  );
}

export interface QueueStatus {
  pending: number;
  running: number;
}

export function getQueueStatus(): QueueStatus {
  const db = getDb();

  const row = db
    .query<{ pending: number; running: number }, []>(
      `SELECT
         SUM(CASE WHEN status = 'queued'  THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
       FROM runs
       WHERE status IN ('queued', 'running')`,
    )
    .get();

  return {
    pending: row?.pending ?? 0,
    running: row?.running ?? 0,
  };
}

export function recoverInterruptedRuns(cloneBasePath?: string | null): Run[] {
  const running = getRunningRuns();

  if (running.length === 0) {
    return [];
  }

  logger.warn('recoverInterruptedRuns: resetting interrupted runs to queued', {
    count: running.length,
    ids: running.map((r) => r.id),
  });

  // Clean up partial clones for each interrupted run
  const basePath = cloneBasePath ?? path.join(os.tmpdir(), 'reviewer-cache');
  for (const run of running) {
    const clonePath = path.join(basePath, run.id);
    if (fs.existsSync(clonePath)) {
      try {
        fs.rmSync(clonePath, { recursive: true, force: true });
        logger.info('Cleaned up partial clone for interrupted run', {
          runId: run.id,
          clonePath,
        });
      } catch (err) {
        logger.warn('Failed to clean up partial clone', {
          runId: run.id,
          clonePath,
          error: String(err),
        });
      }
    }
    // Increment attempt so the retry is distinguishable from the interrupted one
    const db = getDb();
    db.query(`UPDATE runs SET attempt = attempt + 1 WHERE id = ?`).run(run.id);

    updateRunStatus(run.id, 'queued');
  }

  return getQueuedRuns().filter((r) => running.some((orig) => orig.id === r.id));
}
