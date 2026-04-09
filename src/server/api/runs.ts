import { listRuns, getRunWithDetails } from '../../db/runs.ts';
import type { RunStatus } from '../../db/types.ts';
import type { ListRunsFilters } from '../../db/runs.ts';

// ---------------------------------------------------------------------------
// GET /api/runs
// ---------------------------------------------------------------------------

export function handleGetRuns(req: Request): Response {
  const url = new URL(req.url);

  const filters: ListRunsFilters = {};

  const status = url.searchParams.get('status');
  if (status !== null) {
    filters.status = status as RunStatus;
  }

  const repo = url.searchParams.get('repo');
  if (repo !== null) {
    filters.repo = repo;
  }

  const since = url.searchParams.get('since');
  if (since !== null) {
    filters.since = since;
  }

  const runs = listRuns(filters);

  return new Response(JSON.stringify(runs), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// GET /api/runs/:id
// ---------------------------------------------------------------------------

export function handleGetRunDetail(_req: Request, params: { id: string }): Response {
  const run = getRunWithDetails(params.id);

  if (run === null) {
    return new Response(JSON.stringify({ error: 'Run not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(run), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
