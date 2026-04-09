import { useState, useEffect } from 'react';
import { loadCredentials, getConfig } from '../lib/api';
import './ConfigPage.css';

type ConfigSection = 'bot' | 'orchestrator' | 'agents' | 'dashboard' | 'whitelist';

const SECTION_COLORS: Record<string, string> = {
  bot: 'var(--blue)',
  orchestrator: 'var(--amber)',
  agents: 'var(--green)',
  dashboard: 'var(--text-secondary)',
  whitelist: 'var(--text-secondary)',
};

const SECTION_LABELS: Record<string, string> = {
  bot: '⚙ Bot',
  orchestrator: '◈ Orchestrator',
  agents: '⬡ Agents',
  dashboard: '⊞ Dashboard',
  whitelist: '✓ Whitelist',
};

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === 'string') return <span className="json-string">"{value}"</span>;
  if (typeof value === 'number') return <span className="json-number">{value}</span>;
  if (typeof value === 'boolean') return <span className="json-bool">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="json-bracket">[]</span>;
    return (
      <span>
        <span className="json-bracket">[</span>
        <div style={{ paddingLeft: (depth + 1) * 16 }}>
          {value.map((item, i) => (
            <div key={i}>
              <JsonValue value={item} depth={depth + 1} />
              {i < value.length - 1 && <span className="json-punct">,</span>}
            </div>
          ))}
        </div>
        <span className="json-bracket">]</span>
      </span>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="json-bracket">{'{}'}</span>;
    return (
      <span>
        <span className="json-bracket">{'{'}</span>
        <div style={{ paddingLeft: (depth + 1) * 16 }}>
          {entries.map(([k, v], i) => (
            <div key={k} className="json-entry">
              <span className="json-key">"{k}"</span>
              <span className="json-punct">: </span>
              <JsonValue value={v} depth={depth + 1} />
              {i < entries.length - 1 && <span className="json-punct">,</span>}
            </div>
          ))}
        </div>
        <span className="json-bracket">{'}'}</span>
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

export default function ConfigPage() {
  const creds = loadCredentials();
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ConfigSection>('bot');

  useEffect(() => {
    getConfig(creds)
      .then((data) => {
        setConfig(data as Record<string, unknown>);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load config');
        setLoading(false);
      });
  }, [creds]);

  const sections = config
    ? (['bot', 'orchestrator', 'agents', 'dashboard', 'whitelist'] as ConfigSection[]).filter(
        (s) => s in config,
      )
    : [];

  return (
    <>
      <div className="page-header">
        <div className="page-title">⚙ Config</div>
        <div className="mono text-muted" style={{ fontSize: 11 }}>
          read-only · secrets redacted
        </div>
      </div>

      <div className="page-body">
        {error && <div className="error-bar">{error}</div>}

        {loading ? (
          <div className="loading-row"><span className="spinner" /> Loading config...</div>
        ) : config ? (
          <div className="config-layout">
            {/* Section tabs */}
            <div className="config-tabs">
              {sections.map((section) => (
                <button
                  key={section}
                  className={`config-tab ${activeSection === section ? 'active' : ''}`}
                  style={
                    activeSection === section
                      ? { borderColor: SECTION_COLORS[section], color: SECTION_COLORS[section] }
                      : {}
                  }
                  onClick={() => setActiveSection(section)}
                >
                  {SECTION_LABELS[section] ?? section}
                </button>
              ))}
            </div>

            {/* Section content */}
            <div className="config-content card fade-in" key={activeSection}>
              <div className="config-section-header">
                <div
                  className="config-section-title mono"
                  style={{ color: SECTION_COLORS[activeSection] }}
                >
                  {SECTION_LABELS[activeSection] ?? activeSection}
                </div>
              </div>
              <div className="config-json">
                <JsonValue value={config[activeSection]} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
