import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveCredentials, loadCredentials, getQueue } from '../lib/api';
import './LoginPage.css';

export default function LoginPage() {
  const navigate = useNavigate();

  // If already logged in, redirect
  if (loadCredentials()) {
    navigate('/queue', { replace: true });
    return null;
  }

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const creds = { username: username.trim(), password };

    try {
      // Validate by hitting the queue endpoint
      await getQueue(creds);
      saveCredentials(creds);
      navigate('/queue', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      if (msg.includes('Unauthorized') || msg.includes('401')) {
        setError('Invalid credentials');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-glow" />
      <div className="login-card fade-in">
        <div className="login-brand">
          <span className="login-brand-icon">▸</span>
          <span className="login-brand-name">reviewer</span>
          <span className="login-brand-sub">reviewer dashboard</span>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label" htmlFor="username">USERNAME</label>
            <input
              id="username"
              className="input login-input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              disabled={loading}
              required
            />
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="password">PASSWORD</label>
            <input
              id="password"
              className="input login-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <div className="error-bar">{error}</div>
          )}

          <button
            type="submit"
            className="btn btn-primary login-submit"
            disabled={loading || !username}
          >
            {loading ? (
              <>
                <span className="spinner" />
                Authenticating...
              </>
            ) : (
              '→ Connect'
            )}
          </button>
        </form>

        <div className="login-footer">
          Basic auth — credentials stored in localStorage
        </div>
      </div>
    </div>
  );
}
