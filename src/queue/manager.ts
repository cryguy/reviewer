import { dequeue } from '../db/queue.ts';
import { executeRun } from './runner.ts';
import { logger } from '../logger.ts';
import type { Config } from '../config.ts';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _interval: ReturnType<typeof setInterval> | null = null;
let _processing = false;

// ---------------------------------------------------------------------------
// Queue processor
// ---------------------------------------------------------------------------

export function startQueueProcessor(config: Config): void {
  if (_interval !== null) {
    logger.warn('Queue processor already running');
    return;
  }

  logger.info('Starting queue processor', { intervalMs: 1000 });

  _interval = setInterval(async () => {
    // Prevent overlapping processing
    if (_processing) {
      return;
    }

    _processing = true;

    try {
      const run = dequeue();
      if (run === null) {
        return;
      }

      logger.info('Dequeued run', { runId: run.id, repo: run.repo, prNumber: run.pr_number });

      await executeRun(run, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Queue processor tick error', { error: message });
    } finally {
      _processing = false;
    }
  }, 1000);
}

export function stopQueueProcessor(): void {
  if (_interval !== null) {
    clearInterval(_interval);
    _interval = null;
    logger.info('Queue processor stopped');
  }
}
