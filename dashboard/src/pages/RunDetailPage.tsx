import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  loadCredentials,
  getRunDetail,
  pollRunDetail,
  type Credentials,
  type RunWithDetails,
  type AgentOutput,
  type Review,
  type RunStep,
  type RunEvent,
  type InlineComment,
} from '../lib/api';
import { parseUtc } from '../lib/time';
import './RunDetailPage.css';

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hH\d]|<pre|<li|<\/p)(.+)$/gm, '$1')
    .replace(/<li>[\s\S]*?(<\/li>)?/g, (m) => m);
}

function phaseLabel(phase: string | null): string {
  const labels: Record<string, string> = {
    initializing: 'Initializing',
    cloning: 'Cloning repo',
    cloned: 'Repo cloned',
    orchestrating: 'Orchestrating',
    agent_running: 'Agent running',
    agent_done: 'Agent done',
    posting_review: 'Posting review',
    cleanup: 'Cleaning up',
    done: 'Complete',
    failed: 'Failed',
  };
  return phase ? labels[phase] ?? phase : 'Running';
}

function eventColor(eventType: string): string {
  switch (eventType) {
    case 'run_start': return 'var(--blue)';
    case 'agent_spawn': return 'var(--blue)';
    case 'agent_complete': return 'var(--blue)';
    case 'run_complete': return 'var(--green)';
    case 'run_failed': return 'var(--red)';
    case 'step_complete': return 'var(--green)';
    case 'tool_call_end': return 'var(--text-muted)';
    default: return 'var(--text-secondary)';
  }
}

// ---------------------------------------------------------------------------
// Mission Control Components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}

function useTickingElapsed(startIso: string | null, active: boolean): string {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    if (!startIso || !active) {
      if (startIso) setElapsed(formatDurationMs(Date.now() - parseUtc(startIso).getTime()));
      return;
    }
    const tick = () => setElapsed(formatDurationMs(Date.now() - parseUtc(startIso).getTime()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startIso, active]);
  return elapsed;
}

function MCLiveStatus({ run }: { run: RunWithDetails }) {
  const isActive = run.status === 'running' || run.status === 'queued';
  const elapsed = useTickingElapsed(run.started_at, isActive);

  const latestPhaseEvent = [...(run.events ?? [])].reverse().find((e) => e.phase && e.phase !== 'done' && e.phase !== 'failed');
  const currentPhase = latestPhaseEvent ? phaseLabel(latestPhaseEvent.phase) : null;

  const totalDuration = run.started_at && run.completed_at
    ? formatDurationMs(parseUtc(run.completed_at).getTime() - parseUtc(run.started_at).getTime())
    : elapsed;

  let headerPhase = 'Queued';
  if (run.status === 'running') headerPhase = currentPhase ?? 'Running';
  if (run.status === 'completed') headerPhase = 'Mission Accomplished';
  if (run.status === 'failed') headerPhase = 'Mission Failed';

  return (
    <div className={`mc-live-status ${run.status}`}>
      <div className="mc-status-header">
        <span className="mc-status-phase">
          {isActive && <span className="pulse-dot" style={{ background: run.status === 'queued' ? 'var(--gray)' : 'var(--amber)' }} />}
          {headerPhase}
        </span>
        <span className="mc-status-time">{totalDuration || '—'}</span>
      </div>
      <div className="mc-status-metrics">
        <div className="mc-metric">
          <span className="mc-metric-label">Target Repo</span>
          <span className="mc-metric-value">{run.repo.split('/')[1] || run.repo}</span>
        </div>
        <div className="mc-metric">
          <span className="mc-metric-label">Operator</span>
          <span className="mc-metric-value">@{run.trigger_user}</span>
        </div>
      </div>
    </div>
  );
}

function MCTimeline({ events, isRunning }: { events: RunEvent[]; isRunning: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events.length]);

  if (events.length === 0 && !isRunning) return null;

  return (
    <div className="mc-timeline">
      <div className="section-label" style={{ marginBottom: 'var(--sp-2)' }}>Event Log</div>
      {events.map((evt, i) => {
        const isLast = i === events.length - 1;
        return (
          <div key={evt.id} className={`mc-timeline-event ${isLast && isRunning ? 'active' : ''}`}>
            <div className="mc-timeline-icon" style={{ borderColor: isLast && isRunning ? 'var(--blue)' : eventColor(evt.event_type) }} />
            <div className="mc-timeline-content">
              <div className="mc-timeline-phase">{phaseLabel(evt.phase)}</div>
              {evt.message && <div className="mc-timeline-msg">{evt.message}</div>}
              <div className="mc-timeline-time">{new Date(evt.created_at).toLocaleTimeString('en-US', { hour12: false })}</div>
            </div>
          </div>
        );
      })}
      {isRunning && events.length > 0 && (
        <div className="mc-timeline-event active">
          <div className="mc-timeline-icon" style={{ borderColor: 'var(--amber)' }} />
          <div className="mc-timeline-content">
            <div className="mc-timeline-phase text-amber">Processing... <span className="spinner spinner-sm" /></div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function MCSteps({ steps }: { steps: RunStep[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!steps || steps.length === 0) return null;

  return (
    <div className="mc-steps">
      {steps.map(step => {
        const isExpanded = expanded === step.step_number;
        let toolCalls: any[] = [];
        try { toolCalls = JSON.parse(step.tool_calls); } catch {}
        
        return (
          <div key={step.id} className="mc-step">
            <div className="mc-step-header" onClick={() => setExpanded(isExpanded ? null : step.step_number)}>
              <span className="mc-step-title">
                {isExpanded ? '▼' : '▶'} Step {step.step_number}
              </span>
              <span className="mc-step-tools">
                {toolCalls.length > 0 ? toolCalls.map(t => t.toolName).join(', ') : step.assistant_text ? 'Text' : ''}
              </span>
            </div>
            {isExpanded && (
              <div className="mc-step-body">
                {step.reasoning && (
                  <div className="mc-reasoning">{step.reasoning}</div>
                )}
                {step.assistant_text && (
                  <div className="mc-agent-text">{step.assistant_text}</div>
                )}
                {toolCalls.map((tc, i) => (
                  <div key={i} className="mc-agent-text" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                    <strong style={{ color: 'var(--blue)' }}>{tc.toolName}</strong>
                    <br/><br/>
                    {JSON.stringify(tc.args, null, 2)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function MCReview({ review }: { review: Review }) {
  const [expanded, setExpanded] = useState(true);
  let inlineComments: InlineComment[] = [];
  try { inlineComments = JSON.parse(review.inline_comments) as InlineComment[]; } catch {}

  return (
    <div className="mc-review-card fade-in">
      <div className="mc-review-header" onClick={() => setExpanded(!expanded)}>
        <div className="section-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          {expanded ? '▼' : '▶'} Synthesized Review Report
        </div>
        {review.comment_url && (
          <a href={review.comment_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ fontSize: 11 }} onClick={e => e.stopPropagation()}>
            ↗ Open in GitHub
          </a>
        )}
      </div>
      {expanded && (
        <div className="mc-review-body">
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(review.summary) }} />
          
          {inlineComments.length > 0 && (
            <div style={{ marginTop: 'var(--sp-8)' }}>
              <div className="section-label" style={{ marginBottom: 'var(--sp-3)' }}>Annotated Code Comments ({inlineComments.length})</div>
              {inlineComments.map((c, i) => (
                <div key={i} className="mc-inline-comment">
                  <div className="mc-ic-header">
                    <span className="text-blue">{c.path}</span>
                    <span className="text-muted">Line {c.line} {c.side ? `(${c.side})` : ''}</span>
                  </div>
                  <div className="mc-ic-body">{c.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MCStats({ run }: { run: RunWithDetails }) {
  return (
    <div className="mc-stats-card">
      <div className="section-label">Operation Metrics</div>
      <div className="mc-stats-row">
        <span className="text-muted" style={{ fontSize: 12 }}>Total Cost</span>
        <span className="mono text-green">{run.cost_usd !== null ? `$${run.cost_usd.toFixed(4)}` : '—'}</span>
      </div>
      <div className="mc-stats-row">
        <span className="text-muted" style={{ fontSize: 12 }}>Token Usage</span>
        <span className="mono text-primary">{run.total_tokens !== null ? run.total_tokens.toLocaleString() : '—'}</span>
      </div>
      <div className="mc-stats-row">
        <span className="text-muted" style={{ fontSize: 12 }}>Attempts</span>
        <span className="mono text-primary">{run.attempt} / {run.max_attempt}</span>
      </div>
    </div>
  );
}

function MCAgent({ output }: { output: AgentOutput }) {
  const [expanded, setExpanded] = useState(false);
  const type = output.agent_type;
  
  return (
    <div className={`mc-agent-card ${type}`}>
      <div className="mc-agent-header" onClick={() => setExpanded(!expanded)}>
        <span className="mc-agent-title">
          {type === 'claude' ? '🔵 CLAUDE' : type === 'codex' ? '🟢 CODEX' : `⚪ ${String(type).toUpperCase()}`}
        </span>
        <div className="mono text-muted" style={{ fontSize: 10, display: 'flex', gap: '8px' }}>
          {output.duration_ms !== null && <span>{formatDurationMs(output.duration_ms)}</span>}
          <span>{expanded ? '▼' : '▶'}</span>
        </div>
      </div>
      {expanded && (
        <div className="mc-agent-body">
          {output.prompt && (
            <>
              <div className="section-label">Prompt</div>
              <div className="mc-agent-code">{output.prompt}</div>
            </>
          )}
          <div className="section-label">Raw Response</div>
          <div className="mc-agent-code">{output.raw_output || '(no output)'}</div>
        </div>
      )}
    </div>
  );
}

function MCDebug({ run }: { run: RunWithDetails }) {
  const [expanded, setExpanded] = useState(false);
  
  if (!run.system_prompt && !run.orchestrator_input) return null;

  return (
    <div className="mc-debug-panel">
      <div className="mc-debug-header" onClick={() => setExpanded(!expanded)}>
        {expanded ? '▼ Debug Context' : '▶ Debug Context'}
      </div>
      {expanded && (
        <div className="mc-debug-body">
          {run.system_prompt && (
            <div style={{ marginBottom: 'var(--sp-4)' }}>
              <div className="section-label">System Prompt</div>
              <pre className="agent-code" style={{ fontSize: 10, maxHeight: 200, overflow: 'auto', background: 'var(--bg-void)', padding: 'var(--sp-2)' }}>{run.system_prompt}</pre>
            </div>
          )}
          {run.error && (
            <div>
              <div className="section-label text-red">Terminal Error</div>
              <pre className="agent-code text-red" style={{ fontSize: 10, overflow: 'auto', background: 'var(--bg-void)', padding: 'var(--sp-2)' }}>{run.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MCMissionLogTabs({ events, steps, isRunning }: { events: RunEvent[], steps: RunStep[], isRunning: boolean }) {
  const [activeTab, setActiveTab] = useState<'events' | 'actions'>('events');

  return (
    <div className="mc-log-tabs-container">
      <div className="mc-tabs">
        <button
          className={`mc-tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          Event Log
        </button>
        <button
          className={`mc-tab ${activeTab === 'actions' ? 'active' : ''}`}
          onClick={() => setActiveTab('actions')}
        >
          Orchestrator Actions {steps.length > 0 && `(${steps.length})`}
        </button>
      </div>
      <div className="mc-tab-content">
        {activeTab === 'events' && <MCTimeline events={events} isRunning={isRunning} />}
        {activeTab === 'actions' && <MCSteps steps={steps} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const stopPollingRef = useRef<(() => void) | null>(null);

  const startPolling = (creds: Credentials | null, runId: string) => {
    stopPollingRef.current?.();
    setPollError(null);
    stopPollingRef.current = pollRunDetail(creds, runId, 3000, (updated) => {
      setPollError(null);
      setRun(updated);
    }, (_err, { fatal }) => {
      if (fatal) setPollError('Lost connection to server');
    });
  };

  useEffect(() => {
    if (!id) return;
    const creds = loadCredentials();

    getRunDetail(creds, id)
      .then((data) => {
        setRun(data);
        setLoading(false);
        if (data.status === 'queued' || data.status === 'running') {
          startPolling(creds, id);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load run');
        setLoading(false);
      });

    return () => stopPollingRef.current?.();
  }, [id]);

  if (loading) {
    return <div className="loading-row"><span className="spinner" /> Loading mission data...</div>;
  }

  if (error || !run) {
    return (
      <div className="run-detail-page-wrapper">
        <div className="error-bar">{error ?? 'Run not found'}</div>
        <button className="btn" onClick={() => navigate('/runs')}>← Abort and Return</button>
      </div>
    );
  }

  return (
    <div className="run-detail-page-wrapper">
      {pollError && (
        <div className="error-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{pollError}</span>
          <button className="btn" onClick={() => startPolling(loadCredentials(), id!)}>Retry Connection</button>
        </div>
      )}

      {/* Cockpit Header */}
      <div className="cockpit-header">
        <div className="cockpit-left">
          <button className="btn" onClick={() => navigate('/runs')} style={{ padding: 'var(--sp-1) var(--sp-2)' }}>
            ← Back
          </button>
          <div className="cockpit-pr-info">
            <span className="cockpit-repo">{run.repo}</span>
            <span className="cockpit-pr-num">#{run.pr_number}</span>
          </div>
        </div>
        <div className="cockpit-right">
          <StatusBadge status={run.status} />
          {run.pr_url && (
            <a href={run.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              ↗ GitHub PR
            </a>
          )}
        </div>
      </div>

      {/* Bento Grid */}
      <div className="mission-control-grid">
        
        {/* Column 1: Mission Log */}
        <div className="mc-col mission-log">
          <MCLiveStatus run={run} />
          <MCMissionLogTabs 
            events={run.events ?? []} 
            steps={run.steps ?? []} 
            isRunning={run.status === 'queued' || run.status === 'running'} 
          />
        </div>

        {/* Column 2: Main Workspace */}
        <div className="mc-col main-workspace">
          <MCStats run={run} />
          
          {!run.review && (!run.agent_outputs || run.agent_outputs.length === 0) && (
            <div className="empty-state">
              <div className="empty-state-icon">📡</div>
              <div>Awaiting intelligence synthesis...</div>
            </div>
          )}

          {run.review && (
            <MCReview review={run.review} />
          )}

          {run.agent_outputs && run.agent_outputs.length > 0 && (
            <div>
              <div className="section-label" style={{ marginTop: 'var(--sp-4)', marginBottom: 'var(--sp-2)' }}>Agent Interfaces</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                {run.agent_outputs.map(output => (
                  <MCAgent key={output.id} output={output} />
                ))}
              </div>
            </div>
          )}

          <MCDebug run={run} />
        </div>

      </div>
    </div>
  );
}
