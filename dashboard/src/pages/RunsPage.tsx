import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  loadCredentials,
  getRuns,
  type Run,
  type RunStatus,
} from '../lib/api';
import { parseUtc } from '../lib/time';
import './RunsPage.css';

function formatDuration(run: Run): string {
  if (!run.started_at) return '—';
  const end = run.completed_at ? parseUtc(run.completed_at) : new Date();
  const ms = end.getTime() - parseUtc(run.started_at).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function formatTime(iso: string): string {
  return parseUtc(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }) + ' UTC';
}

function StatusPill({ status }: { status: RunStatus }) {
  return (
    <span className={`pill pill-${status}`}>
      {status === 'running' && <span className="pulse-dot" />}
      {status}
    </span>
  );
}

function CostDisplay({ cost, tokens }: { cost: number | null; tokens: number | null }) {
  if (cost === null && tokens === null) return <span className="text-muted">—</span>;
  return (
    <div className="cost-cell">
      {cost !== null && <span className="cost-usd">${cost.toFixed(4)}</span>}
      {tokens !== null && (
        <span className="cost-tokens mono text-muted">{tokens.toLocaleString()} tok</span>
      )}
    </div>
  );
}

export default function RunsPage() {
  const navigate = useNavigate();

  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RunStatus | ''>('');
  const [repoFilter, setRepoFilter] = useState('');
  const [repoInput, setRepoInput] = useState('');

  const fetchRuns = useCallback(async () => {
    try {
      const filters: { status?: RunStatus; repo?: string } = {};
      if (statusFilter) filters.status = statusFilter;
      if (repoFilter) filters.repo = repoFilter;
      const result = await getRuns(loadCredentials(), filters);
      setRuns(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch runs');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, repoFilter]);

  useEffect(() => {
    setLoading(true);
    fetchRuns();
  }, [fetchRuns]);

  function applyRepoFilter() {
    setRepoFilter(repoInput.trim());
  }

  function clearFilters() {
    setStatusFilter('');
    setRepoFilter('');
    setRepoInput('');
  }

  const hasFilters = statusFilter || repoFilter;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">≡ Runs</div>
        </div>
        <div className="runs-meta mono text-muted">
          {!loading && `${runs.length} result${runs.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      <div className="page-body">
        {/* Filters */}
        <div className="filters-bar">
          <div className="filter-group">
            <label className="section-label">Status</label>
            <select
              className="input filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as RunStatus | '')}
            >
              <option value="">All</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="filter-group filter-group-repo">
            <label className="section-label">Repo</label>
            <div className="repo-input-row">
              <input
                className="input"
                type="text"
                placeholder="owner/repo"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyRepoFilter()}
              />
              <button className="btn" onClick={applyRepoFilter}>Filter</button>
            </div>
          </div>

          {hasFilters && (
            <button className="btn filter-clear" onClick={clearFilters}>
              ✕ Clear
            </button>
          )}
        </div>

        {error && <div className="error-bar">{error}</div>}

        {/* Table */}
        <div className="card table-wrapper">
          {loading ? (
            <div className="loading-row"><span className="spinner" /> Loading runs...</div>
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">○</div>
              <div>No runs found</div>
              {hasFilters && <div className="text-muted">Try clearing filters</div>}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>PR</th>
                  <th>Status</th>
                  <th>Triggered by</th>
                  <th>Trigger</th>
                  <th>Duration</th>
                  <th>Cost</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => navigate(`/runs/${run.id}`)}
                  >
                    <td>
                      <div className="pr-cell">
                        <span className="pr-repo text-muted mono">{run.repo}</span>
                        <span className="pr-number mono">#{run.pr_number}</span>
                      </div>
                    </td>
                    <td><StatusPill status={run.status} /></td>
                    <td>
                      <span className="mono text-secondary">@{run.trigger_user}</span>
                    </td>
                    <td>
                      <span className="trigger-snippet text-muted" title={run.trigger_body}>
                        {run.trigger_body.replace(/@\S+\s*/, '').slice(0, 60) || run.trigger_body.slice(0, 60)}
                        {run.trigger_body.length > 60 ? '...' : ''}
                      </span>
                    </td>
                    <td>
                      <span className="mono text-secondary">{formatDuration(run)}</span>
                    </td>
                    <td>
                      <CostDisplay cost={run.cost_usd} tokens={run.total_tokens} />
                    </td>
                    <td>
                      <span className="mono text-muted" style={{ fontSize: 12 }}>
                        {formatTime(run.created_at)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
