import { dequeue } from '../db/queue.ts';
import { executeRun } from './runner.ts';
import { logger } from '../logger.ts';
import type { Config } from '../config.ts';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _interval: ReturnType<typeof setInterval> | null = null;

/** Active runs: run ID → pr_url (used for concurrency + PR-level dedup) */
const _activeRuns = new Map<string, string>();

// ---------------------------------------------------------------------------
// Accessors (for PR-aware dequeue in queue.ts)
// ---------------------------------------------------------------------------

/** Returns the set of pr_urls that currently have a running run. */
export function getActivePrUrls(): Set<string> {
  return new Set(_activeRuns.values());
}

// ---------------------------------------------------------------------------
// Queue processor
// ---------------------------------------------------------------------------

export function startQueueProcessor(config: Config): void {
  if (_interval !== null) {
    logger.warn('Queue processor already running');
    return;
  }

  const maxConcurrent = config.bot.maxConcurrentRuns;
  logger.info('Starting queue processor', { intervalMs: 1000, maxConcurrent });

  _interval = setInterval(() => {
    // Skip if at capacity
    if (_activeRuns.size >= maxConcurrent) {
      return;
    }

    try {
      const run = dequeue(getActivePrUrls());
      if (run === null) {
        return;
      }

      logger.info('Dequeued run', {
        runId: run.id,
        repo: run.repo,
        prNumber: run.pr_number,
        activeRuns: _activeRuns.size + 1,
        maxConcurrent,
      });

      _activeRuns.set(run.id, run.pr_url);

      // Fire-and-forget — run executes independently
      executeRun(run, config)
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('Run execution failed (uncaught)', { runId: run.id, error: message });
        })
        .finally(() => {
          _activeRuns.delete(run.id);
          logger.info('Run slot freed', {
            runId: run.id,
            activeRuns: _activeRuns.size,
            maxConcurrent,
          });
        });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Queue processor tick error', { error: message });
    }
  }, 1000);
}

export function stopQueueProcessor(): void {
  if (_interval !== null) {
    clearInterval(_interval);
    _interval = null;
    logger.info('Queue processor stopped', { activeRuns: _activeRuns.size });
  }
}
