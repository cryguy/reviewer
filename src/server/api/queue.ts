import { getQueuedRuns, getRunningRuns } from '../../db/runs.ts';

// ---------------------------------------------------------------------------
// GET /api/queue
// ---------------------------------------------------------------------------

export function handleGetQueue(_req: Request): Response {
  const pending = getQueuedRuns();
  const running = getRunningRuns();

  const body = JSON.stringify({
    pending,
    running,
    counts: {
      pending: pending.length,
      running: running.length,
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
