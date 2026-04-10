import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { loadCredentials, getQueue, type Run, type QueueResponse } from '../lib/api';
import { parseUtc } from '../lib/time';
import './QueuePage.css';

const POLL_INTERVAL_MS = 3000;

function formatElapsed(startedAt: string): string {
  const diffMs = Date.now() - parseUtc(startedAt).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function formatAge(createdAt: string): string {
  const diffMs = Date.now() - parseUtc(createdAt).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function RunningCard({ run }: { run: Run }) {
  const [elapsed, setElapsed] = useState(
    run.started_at ? formatElapsed(run.started_at) : '—'
  );

  useEffect(() => {
    if (!run.started_at) return;
    const interval = setInterval(() => {
      setElapsed(formatElapsed(run.started_at!));
    }, 1000);
    return () => clearInterval(interval);
  }, [run.started_at]);

  return (
    <Link to={`/runs/${run.id}`} className="running-card fade-in">
      <div className="running-card-header">
        <div className="running-indicator">
          <span className="pulse-dot" />
          <span className="running-label">RUNNING</span>
        </div>
        <div className="running-elapsed mono">{elapsed}</div>
      </div>

      <div className="running-card-body">
        <div className="run-pr-line">
          <a
            href={run.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="run-pr-link"
            onClick={(e) => e.stopPropagation()}
          >
            {run.repo}#{run.pr_number}
          </a>
          <span className="run-trigger-user">triggered by @{run.trigger_user}</span>
        </div>
        {run.trigger_body && (
          <div className="run-trigger-body mono">{run.trigger_body.slice(0, 120)}</div>
        )}
      </div>

      <div className="running-card-footer">
        <span className="mono text-muted">timeout: {run.timeout_minutes}m</span>
        <span className="mono text-muted">id: {run.id.slice(0, 8)}</span>
      </div>
    </Link>
  );
}

function QueuedRow({ run, position }: { run: Run; position: number }) {
  return (
    <Link to={`/runs/${run.id}`} className="queued-row fade-in">
      <div className="queued-position mono">#{position}</div>
      <div className="queued-body">
        <div className="queued-pr">
          <span className="queued-emoji">👀</span>
          <a
            href={run.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="run-pr-link"
            onClick={(e) => e.stopPropagation()}
          >
            {run.repo}#{run.pr_number}
          </a>
        </div>
        <div className="queued-meta mono text-muted">
          @{run.trigger_user} · {formatAge(run.created_at)}
        </div>
      </div>
      <div className="queued-trigger mono text-muted">
        {run.trigger_body.slice(0, 60)}
      </div>
    </Link>
  );
}

export default function QueuePage() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await getQueue(loadCredentials());
      setData(result);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch queue');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">⬡ Queue</div>
        </div>
        <div className="queue-status-row">
          {lastUpdated && (
            <span className="mono text-muted" style={{ fontSize: 11 }}>
              updated {formatAge(lastUpdated.toISOString())}
            </span>
          )}
          <span className="pill pill-running">
            <span className="pulse-dot" />
            live · 3s
          </span>
        </div>
      </div>

      <div className="page-body">
        {error && <div className="error-bar">{error}</div>}

        {/* Running section */}
        <section>
          <div className="section-header">
            <div className="section-label">🚀 Running</div>
            <div className="section-count mono">{data?.counts.running ?? '—'}</div>
          </div>
          {!data ? (
            <div className="loading-row"><span className="spinner" /> Loading...</div>
          ) : data.running.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--sp-8)' }}>
              <div className="empty-state-icon">🏁</div>
              <div>No active runs</div>
            </div>
          ) : (
            <div className="running-list">
              {data.running.map((run) => (
                <RunningCard key={run.id} run={run} />
              ))}
            </div>
          )}
        </section>

        {/* Pending section */}
        <section>
          <div className="section-header">
            <div className="section-label">👀 Pending</div>
            <div className="section-count mono">{data?.counts.pending ?? '—'}</div>
          </div>
          {!data ? (
            <div className="loading-row"><span className="spinner" /> Loading...</div>
          ) : data.pending.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--sp-8)' }}>
              <div className="empty-state-icon">✓</div>
              <div>Queue is empty</div>
            </div>
          ) : (
            <div className="queued-list card">
              {data.pending.map((run, i) => (
                <QueuedRow key={run.id} run={run} position={i + 1} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
