import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component, useEffect, type ReactNode } from 'react';
import { useStore } from '@/store/useStore';
import { LoginPage } from '@/pages/auth/LoginPage';
import { UserRadioPage } from '@/pages/user/UserRadioPage';
import { DispatcherLayout } from '@/pages/dispatcher/DispatcherLayout';
import { AdminLayout } from '@/pages/admin/AdminLayout';
import { unlockAudio } from '@/hooks/useWebRTC';

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

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useStore((s) => s.accessToken);
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
  useEffect(() => {
    useStore.persist.rehydrate();
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
          <Route path="/login" element={<LoginPage />} />

          <Route path="/" element={<RequireAuth><RoleRouter /></RequireAuth>} />

          <Route path="/radio/*" element={<RequireAuth><ErrorBoundary><UserRadioPage /></ErrorBoundary></RequireAuth>} />
          <Route path="/dispatcher/*" element={<RequireAuth><ErrorBoundary><DispatcherLayout /></ErrorBoundary></RequireAuth>} />
          <Route path="/admin/*" element={<RequireAuth><ErrorBoundary><AdminLayout /></ErrorBoundary></RequireAuth>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
