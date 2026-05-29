import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { useStore } from '@/store/useStore';
import { LoginPage } from '@/pages/auth/LoginPage';
import { UserRadioPage } from '@/pages/user/UserRadioPage';
import { DispatcherLayout } from '@/pages/dispatcher/DispatcherLayout';
import { AdminLayout } from '@/pages/admin/AdminLayout';
import { DownloadPage, DocsPage, FaqPage, HomePage, StatusPage, SupportPage } from '@/pages/public/PublicPages';
import { unlockAudio } from '@/hooks/useWebRTC';
import { authApi } from '@/api/client';
import type { User } from '@/types';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, background: '#0A0C0A', color: '#FF4444', fontFamily: 'monospace', minHeight: '100vh' }}>
          <h2 style={{ color: '#3DDC84' }}>RENDER ERROR</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {(this.state.error as Error).message}
            {'\n\n'}
            {(this.state.error as Error).stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthLoading() {
  return (
    <div className="min-h-screen bg-ptt-dark text-ptt-green flex items-center justify-center font-mono text-xs tracking-widest">
      CONNECTING...
    </div>
  );
}

function RequireAuth({ children, authReady }: { children: ReactNode; authReady: boolean }) {
  const token = useStore((s) => s.accessToken);
  if (!authReady) return <AuthLoading />;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleRouter() {
  const user = useStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;

  if (user.role === 'USER') return <Navigate to="/radio" replace />;
  if (user.role === 'DISPATCHER') return <Navigate to="/dispatcher" replace />;
  if (user.role === 'ADMIN' || user.role === 'SUPERADMIN') return <Navigate to="/admin" replace />;
  return <Navigate to="/radio" replace />;
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSession() {
      await useStore.persist.rehydrate();

      const path = window.location.pathname;
      const isProtectedPath =
        path === '/app' ||
        path.startsWith('/radio') ||
        path.startsWith('/dispatcher') ||
        path.startsWith('/admin');

      if (isProtectedPath) {
        const state = useStore.getState();
        const hasStoredSession =
          Boolean(localStorage.getItem('accessToken') || state.accessToken) &&
          Boolean(localStorage.getItem('refreshToken') || state.refreshToken);

        if (hasStoredSession) {
          try {
            const user = await authApi.me();
            const accessToken = localStorage.getItem('accessToken') ?? useStore.getState().accessToken;
            const refreshToken = localStorage.getItem('refreshToken') ?? useStore.getState().refreshToken;
            if (accessToken && refreshToken) {
              useStore.getState().setAuth(user as User, accessToken, refreshToken);
            }
          } catch {
            useStore.getState().clearAuth();
          }
        }
      }

      if (!cancelled) setAuthReady(true);
    }

    bootstrapSession().catch(() => {
      useStore.getState().clearAuth();
      if (!cancelled) setAuthReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Разблокируем AudioContext при любом касании — нужно для Safari и мобильных браузеров
  useEffect(() => {
    const unlock = () => {
      unlockAudio().catch(() => {});
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
    };
  }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/download" element={<DownloadPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/login" element={<LoginPage />} />

          <Route path="/app" element={<RequireAuth authReady={authReady}><RoleRouter /></RequireAuth>} />

          <Route path="/radio/*" element={<RequireAuth authReady={authReady}><ErrorBoundary><UserRadioPage /></ErrorBoundary></RequireAuth>} />
          <Route path="/dispatcher/*" element={<RequireAuth authReady={authReady}><ErrorBoundary><DispatcherLayout /></ErrorBoundary></RequireAuth>} />
          <Route path="/admin/*" element={<RequireAuth authReady={authReady}><ErrorBoundary><AdminLayout /></ErrorBoundary></RequireAuth>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
