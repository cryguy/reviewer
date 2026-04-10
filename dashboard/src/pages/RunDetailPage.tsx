import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  loadCredentials,
  getRunDetail,
  pollRunDetail,
  type RunWithDetails,
  type AgentOutput,
  type Review,
  type RunStep,
  type RunEvent,
  type InlineComment,
} from '../lib/api';
import './RunDetailPage.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function formatRunDuration(run: RunWithDetails): string {
  if (!run.started_at) return '—';
  const end = run.completed_at ? new Date(run.completed_at) : new Date();
  const ms = end.getTime() - new Date(run.started_at).getTime();
  return formatDurationMs(ms);
}

// ---------------------------------------------------------------------------
// Markdown renderer (simple subset — headings, bold, code, bullets)
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): string {
  return text
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Bullet lists
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    // Newlines to paragraphs (crude but effective)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hH\d]|<pre|<li|<\/p)(.+)$/gm, '$1')
    .replace(/<li>[\s\S]*?(<\/li>)?/g, (m) => m) // keep lists
    ;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}

function TimingBar({ run }: { run: RunWithDetails }) {
  return (
    <div className="timing-bar card">
      <div className="timing-step">
        <div className="timing-step-label section-label">Queued</div>
        <div className="timing-step-time mono">{formatTime(run.created_at)}</div>
      </div>
      <div className="timing-arrow">→</div>
      <div className="timing-step">
        <div className="timing-step-label section-label">Started</div>
        <div className="timing-step-time mono">
          {run.started_at ? formatTime(run.started_at) : '—'}
        </div>
      </div>
      <div className="timing-arrow">→</div>
      <div className="timing-step">
        <div className="timing-step-label section-label">Finished</div>
        <div className="timing-step-time mono">
          {run.completed_at ? formatTime(run.completed_at) : '—'}
        </div>
      </div>
      <div className="timing-duration">
        <div className="timing-step-label section-label">Total</div>
        <div className="timing-step-time mono" style={{ color: 'var(--text-primary)', fontSize: 15 }}>
          {formatRunDuration(run)}
        </div>
      </div>
    </div>
  );
}

function AgentPanel({ output, isFirst }: { output: AgentOutput; isFirst: boolean }) {
  const isClaude = output.agent_type === 'claude';
  const [collapsed, setCollapsed] = useState(!isFirst);

  const accentColor = isClaude ? 'var(--blue)' : 'var(--green)';
  const agentBg = isClaude ? 'var(--blue-bg)' : 'var(--green-bg)';
  const agentEmoji = isClaude ? '🔵' : '🟢';
  const totalTokens =
    (output.tokens_prompt ?? 0) + (output.tokens_completion ?? 0);

  return (
    <div
      className="agent-panel card"
      style={{ borderColor: isClaude ? 'var(--blue-dim)' : 'var(--green-dim)' }}
    >
      <div
        className="agent-panel-header"
        style={{ background: agentBg, borderBottom: `1px solid var(--border-dim)` }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="agent-panel-title">
          <span>{agentEmoji}</span>
          <span className="agent-name" style={{ color: accentColor }}>
            {output.agent_type.toUpperCase()}
          </span>
        </div>
        <div className="agent-panel-meta">
          {output.duration_ms !== null && (
            <span className="mono text-muted" style={{ fontSize: 12 }}>
              {formatDurationMs(output.duration_ms)}
            </span>
          )}
          {totalTokens > 0 && (
            <span className="mono text-muted" style={{ fontSize: 12 }}>
              {totalTokens.toLocaleString()} tok
            </span>
          )}
          <span className="collapse-toggle" style={{ color: accentColor }}>
            {collapsed ? '▶ expand' : '▼ collapse'}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="agent-panel-body">
          {output.prompt && (
            <details className="prompt-details">
              <summary className="prompt-summary section-label">Prompt</summary>
              <pre className="agent-code">{output.prompt}</pre>
            </details>
          )}
          <div className="agent-output-label section-label">Raw Output</div>
          <pre className="agent-code agent-output">
            {output.raw_output ?? '(no output)'}
          </pre>
        </div>
      )}
    </div>
  );
}

function ReviewSection({ review }: { review: Review }) {
  let inlineComments: InlineComment[] = [];
  try {
    inlineComments = JSON.parse(review.inline_comments) as InlineComment[];
  } catch {
    inlineComments = [];
  }

  return (
    <div className="review-section">
      <div className="section-header-row">
        <div className="section-label">Synthesized Review</div>
        {review.comment_url && (
          <a
            href={review.comment_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
            style={{ fontSize: 11 }}
          >
            ↗ View on GitHub
          </a>
        )}
      </div>

      <div
        className="review-body card"
        dangerouslySetInnerHTML={{ __html: '<p>' + renderMarkdown(review.summary) + '</p>' }}
      />

      {inlineComments.length > 0 && (
        <div className="inline-comments">
          <div className="section-label" style={{ marginBottom: 'var(--sp-3)' }}>
            Inline Comments ({inlineComments.length})
          </div>
          {inlineComments.map((c, i) => (
            <div key={i} className="inline-comment card">
              <div className="inline-comment-header">
                <span className="mono text-blue">{c.path}</span>
                <span className="mono text-muted">L{c.line}</span>
                {c.side && (
                  <span className="pill pill-queued" style={{ fontSize: 9 }}>{c.side}</span>
                )}
              </div>
              <div className="inline-comment-body">{c.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ToolCallEntry {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

function StepsTimeline({ steps }: { steps: RunStep[] }) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (steps.length === 0) return null;

  return (
    <div className="steps-section">
      <div className="section-label" style={{ marginBottom: 'var(--sp-3)' }}>
        Orchestrator Steps ({steps.length})
      </div>
      <div className="steps-timeline">
        {steps.map((step) => {
          let toolCalls: ToolCallEntry[] = [];
          try { toolCalls = JSON.parse(step.tool_calls) as ToolCallEntry[]; } catch { /* empty */ }
          const isExpanded = expandedStep === step.step_number;
          const totalTokens = (step.usage_input ?? 0) + (step.usage_output ?? 0);

          return (
            <div key={step.id} className="step-item card">
              <div
                className="step-header"
                onClick={() => setExpandedStep(isExpanded ? null : step.step_number)}
              >
                <div className="step-header-left">
                  <span className="step-number">Step {step.step_number}</span>
                  <span className="step-tools-summary mono text-muted">
                    {toolCalls.length > 0
                      ? toolCalls.map((tc) => tc.toolName).join(' → ')
                      : '(no tool calls)'}
                  </span>
                </div>
                <div className="step-header-right">
                  {totalTokens > 0 && (
                    <span className="mono text-muted" style={{ fontSize: 11 }}>
                      {(step.usage_input ?? 0).toLocaleString()} in / {(step.usage_output ?? 0).toLocaleString()} out
                    </span>
                  )}
                  <span className="collapse-toggle" style={{ fontSize: 11 }}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </div>
              </div>

              {isExpanded && toolCalls.length > 0 && (
                <div className="step-details">
                  {toolCalls.map((tc, i) => (
                    <div key={i} className="step-tool-call">
                      <div className="step-tool-name mono">{tc.toolName}</div>
                      <details className="step-tool-data">
                        <summary className="text-muted" style={{ fontSize: 11, cursor: 'pointer' }}>
                          args
                        </summary>
                        <pre className="step-tool-json">{JSON.stringify(tc.args, null, 2)}</pre>
                      </details>
                      {tc.result !== undefined && (
                        <details className="step-tool-data">
                          <summary className="text-muted" style={{ fontSize: 11, cursor: 'pointer' }}>
                            result
                          </summary>
                          <pre className="step-tool-json">
                            {typeof tc.result === 'string'
                              ? tc.result.slice(0, 2000)
                              : JSON.stringify(tc.result, null, 2)?.slice(0, 2000)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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
  return phase ? labels[phase] ?? phase : '';
}

function eventIcon(eventType: string): string {
  const icons: Record<string, string> = {
    run_start: '\u25B6',     // ▶
    phase_change: '\u25CF',  // ●
    tool_call_end: '\u25A0', // ■
    agent_spawn: '\u25B7',   // ▷
    agent_complete: '\u25C0',// ◀
    step_complete: '\u2713', // ✓
    run_complete: '\u2714',  // ✔
    run_failed: '\u2718',    // ✘
  };
  return icons[eventType] ?? '\u25CB'; // ○
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

function LiveTimeline({ events, isRunning }: { events: RunEvent[]; isRunning: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  if (events.length === 0 && !isRunning) return null;

  return (
    <div className="live-timeline-section">
      <div className="section-label" style={{ marginBottom: 'var(--sp-3)' }}>
        Live Activity {isRunning && <span className="pulse-dot" />}
      </div>
      <div className="live-timeline card">
        {events.length === 0 ? (
          <div className="live-timeline-empty mono text-muted">Waiting for events...</div>
        ) : (
          events.map((evt) => (
            <div key={evt.id} className="live-event" style={{ borderLeftColor: eventColor(evt.event_type) }}>
              <span className="live-event-icon" style={{ color: eventColor(evt.event_type) }}>
                {eventIcon(evt.event_type)}
              </span>
              <span className="live-event-phase mono">{phaseLabel(evt.phase)}</span>
              <span className="live-event-message">{evt.message}</span>
              <span className="live-event-time mono text-muted">
                {new Date(evt.created_at).toLocaleTimeString('en-US', { hour12: false })}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function AttemptTabs({ current, total }: { current: number; total: number }) {
  if (total <= 1) return null;
  return (
    <div className="attempt-bar">
      <span className="section-label">Attempt</span>
      <span className="attempt-badge mono">{current} / {total}</span>
      {current > 1 && (
        <span className="attempt-hint text-muted">
          Previous {current - 1 === 1 ? 'attempt' : `${current - 1} attempts`} interrupted
        </span>
      )}
    </div>
  );
}

function DirectResponseSection({ run }: { run: RunWithDetails }) {
  if (!run.review) return null;
  return (
    <div className="review-section">
      <div className="section-header-row">
        <div className="section-label">Direct Response</div>
        {run.review.comment_url && (
          <a
            href={run.review.comment_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
            style={{ fontSize: 11 }}
          >
            ↗ View on GitHub
          </a>
        )}
      </div>
      <div
        className="review-body card"
        dangerouslySetInnerHTML={{ __html: '<p>' + renderMarkdown(run.review.summary) + '</p>' }}
      />
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

  const stopPollingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!id) return;
    const creds = loadCredentials();

    getRunDetail(creds, id)
      .then((data) => {
        setRun(data);
        setLoading(false);

        // Start polling if the run is still active
        if (data.status === 'queued' || data.status === 'running') {
          stopPollingRef.current = pollRunDetail(creds, id, 3000, (updated) => {
            setRun(updated);
          });
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load run');
        setLoading(false);
      });

    return () => {
      stopPollingRef.current?.();
    };
  }, [id]);

  if (loading) {
    return (
      <>
        <div className="page-header">
          <div className="page-title">Run Detail</div>
        </div>
        <div className="loading-row"><span className="spinner" /> Loading run...</div>
      </>
    );
  }

  if (error || !run) {
    return (
      <>
        <div className="page-header">
          <div className="page-title">Run Detail</div>
        </div>
        <div className="page-body">
          <div className="error-bar">{error ?? 'Run not found'}</div>
          <button className="btn" onClick={() => navigate('/runs')}>← Back to Runs</button>
        </div>
      </>
    );
  }

  const hasAgentOutputs = run.agent_outputs.length > 0;

  // Group by agent type
  const claudeOutput = run.agent_outputs.find((o) => o.agent_type === 'claude') ?? null;
  const codexOutput = run.agent_outputs.find((o) => o.agent_type === 'codex') ?? null;

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="detail-header-left">
          <button
            className="btn back-btn"
            onClick={() => navigate('/runs')}
          >
            ← Runs
          </button>
          <div className="detail-pr-title">
            <span className="mono text-muted">{run.repo}</span>
            <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
              #{run.pr_number}
            </span>
          </div>
        </div>
        <div className="detail-header-right">
          <StatusBadge status={run.status} />
          {run.pr_url && (
            <a
              href={run.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
            >
              ↗ GitHub PR
            </a>
          )}
        </div>
      </div>

      <div className="page-body detail-body">
        {/* Attempt indicator */}
        <AttemptTabs current={run.attempt} total={run.attempt} />

        {/* Live activity timeline (shown for active or recently completed runs) */}
        <LiveTimeline
          events={run.events ?? []}
          isRunning={run.status === 'running' || run.status === 'queued'}
        />

        {/* Metadata */}
        <div className="meta-grid">
          <div className="meta-item">
            <div className="section-label">Triggered by</div>
            <div className="mono">@{run.trigger_user}</div>
          </div>
          <div className="meta-item">
            <div className="section-label">Trigger</div>
            <div className="mono text-secondary" style={{ fontSize: 12 }}>
              {run.trigger_body.slice(0, 80)}
            </div>
          </div>
          <div className="meta-item">
            <div className="section-label">Cost</div>
            <div className="mono" style={{ color: 'var(--green)' }}>
              {run.cost_usd !== null ? `$${run.cost_usd.toFixed(4)}` : '—'}
            </div>
          </div>
          <div className="meta-item">
            <div className="section-label">Tokens</div>
            <div className="mono text-secondary">
              {run.total_tokens !== null ? run.total_tokens.toLocaleString() : '—'}
            </div>
          </div>
          {run.error && (
            <div className="meta-item meta-item-error">
              <div className="section-label" style={{ color: 'var(--red)' }}>Error</div>
              <div className="mono" style={{ color: 'var(--red)', fontSize: 12 }}>
                {run.error}
              </div>
            </div>
          )}
        </div>

        {/* Timing */}
        <TimingBar run={run} />

        {/* Orchestrator Steps */}
        {run.steps && run.steps.length > 0 && <StepsTimeline steps={run.steps} />}

        {/* Agent outputs */}
        {hasAgentOutputs ? (
          <div className="agent-outputs-section">
            <div className="section-label" style={{ marginBottom: 'var(--sp-3)' }}>
              Agent Outputs ({run.agent_outputs.length})
            </div>
            <div className="agent-panels">
              {claudeOutput && (
                <AgentPanel output={claudeOutput} isFirst={!codexOutput || true} />
              )}
              {codexOutput && (
                <AgentPanel output={codexOutput} isFirst={!claudeOutput} />
              )}
              {/* Any other outputs */}
              {run.agent_outputs
                .filter((o) => o.agent_type !== 'claude' && o.agent_type !== 'codex')
                .map((o, i) => (
                  <AgentPanel key={o.id} output={o} isFirst={i === 0} />
                ))}
            </div>
          </div>
        ) : (
          run.review && <DirectResponseSection run={run} />
        )}

        {/* Review (only when there were agent outputs) */}
        {hasAgentOutputs && run.review && <ReviewSection review={run.review} />}
      </div>
    </>
  );
}
