import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDb } from './index.ts';
import { createRun, getRun, getQueuedRuns, getRunningRuns, updateRunStatus } from './runs.ts';
import type { Run } from './types.ts';
import type { CreateRunParams } from './runs.ts';
import { logger } from '../logger.ts';

type NamedBinding = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export interface EnqueueResult {
  run: Run;
  merged: boolean;
}

export function enqueue(params: CreateRunParams): EnqueueResult {
  const db = getDb();

  // Check for an existing queued run for the same PR
  const existing = db
    .query<Run, [NamedBinding]>(
      `SELECT * FROM runs WHERE pr_url = $pr_url AND status = 'queued' ORDER BY created_at ASC LIMIT 1`,
    )
    .get({ $pr_url: params.pr_url });

  if (existing) {
    // Merge: append new trigger body with attribution
    const separator = `\n\n---\n[follow-up from @${params.trigger_user}]\n`;
    const mergedBody = existing.trigger_body + separator + params.trigger_body;

    // Append new comment ID to the merged list
    const existingIds: number[] = JSON.parse(existing.merged_comment_ids || '[]');
    existingIds.push(params.trigger_comment_id);

    db.query(
      `UPDATE runs SET trigger_body = ?, merged_comment_ids = ? WHERE id = ?`,
    ).run(mergedBody, JSON.stringify(existingIds), existing.id);

    const updated = getRun(existing.id)!;
    logger.info('Merged mention into existing queued run', {
      runId: existing.id,
      mergedCommentId: params.trigger_comment_id,
      mergedUser: params.trigger_user,
      totalMerged: existingIds.length,
    });
    return { run: updated, merged: true };
  }

  return { run: createRun(params), merged: false };
}

/**
 * Dequeue the next eligible run. Skips runs whose pr_url is already active
 * (PR-level serialization) to prevent concurrent reviews of the same PR.
 */
export function dequeue(activePrUrls?: Set<string>): Run | null {
  const db = getDb();

  // Use a transaction to atomically fetch + mark as running
  const tx = db.transaction((): Run | null => {
    let next: Run | null;

    if (activePrUrls && activePrUrls.size > 0) {
      // Build parameterized exclusion to avoid SQL injection
      const urls = [...activePrUrls];
      const placeholders = urls.map(() => '?').join(', ');
      next = db
        .query<Run, string[]>(
          `SELECT * FROM runs WHERE status = 'queued' AND pr_url NOT IN (${placeholders}) ORDER BY created_at ASC LIMIT 1`,
        )
        .get(...urls) ?? null;
    } else {
      next = db
        .query<Run, []>(
          `SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
        )
        .get() ?? null;
    }

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
  const db = getDb();

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

    // Check if this run already posted a review or emitted a run_complete event.
    // If so, it actually finished — mark completed instead of re-queuing.
    const hasReview = db
      .query<{ id: string }, [string]>(`SELECT id FROM reviews WHERE run_id = ? LIMIT 1`)
      .get(run.id);
    const hasCompleteEvent = db
      .query<{ id: string }, [string, string]>(
        `SELECT id FROM run_events WHERE run_id = ? AND event_type = ? LIMIT 1`,
      )
      .get(run.id, 'run_complete');

    if (hasReview || hasCompleteEvent) {
      logger.info('Interrupted run already completed its work, marking as completed', {
        runId: run.id,
        hadReview: !!hasReview,
        hadCompleteEvent: !!hasCompleteEvent,
      });
      db.query(`UPDATE runs SET status = 'completed', completed_at = datetime('now') WHERE id = ?`).run(run.id);
      continue;
    }

    // Atomically increment attempt + reset status so a crash between writes
    // can't leave the run in an inconsistent state.
    db.query(`UPDATE runs SET attempt = attempt + 1, status = 'queued' WHERE id = ?`).run(run.id);
  }

  return getQueuedRuns().filter((r) => running.some((orig) => orig.id === r.id));
}
