import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { loadCredentials, clearCredentials } from './lib/api';
import LoginPage from './pages/LoginPage';
import QueuePage from './pages/QueuePage';
import RunsPage from './pages/RunsPage';
import RunDetailPage from './pages/RunDetailPage';
import './styles/app.css';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const creds = loadCredentials();
  if (!creds) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function Layout({ children }: { children: React.ReactNode }) {
  function handleLogout() {
    clearCredentials();
    window.location.href = '/login';
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">▸</span>
          <span className="brand-name">reviewer</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Monitor</div>
          <NavLink to="/queue" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">⬡</span>
            Queue
          </NavLink>
          <NavLink to="/runs" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">≡</span>
            Runs
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <button className="logout-btn" onClick={handleLogout}>
            <span>⏻</span> Logout
          </button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/queue"
          element={
            <RequireAuth>
              <Layout><QueuePage /></Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/runs"
          element={
            <RequireAuth>
              <Layout><RunsPage /></Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/runs/:id"
          element={
            <RequireAuth>
              <Layout><RunDetailPage /></Layout>
            </RequireAuth>
          }
        />
        <Route path="/" element={<Navigate to="/queue" replace />} />
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
