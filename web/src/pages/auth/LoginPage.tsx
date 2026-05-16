import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, AlertCircle, Loader2 } from 'lucide-react';
import { authApi } from '@/api/client';
import { useStore } from '@/store/useStore';
import type { User } from '@/types';

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useStore((s) => s.setAuth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await authApi.login(email, password);
      setAuth(data.user as User, data.accessToken, data.refreshToken);

      // Редирект по роли
      const role = data.user.role;
      if (role === 'USER') navigate('/radio');
      else if (role === 'DISPATCHER') navigate('/dispatcher');
      else navigate('/admin');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-ptt-dark flex items-center justify-center p-4 relative overflow-hidden">
      {/* Фоновые декоративные элементы */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full scanlines opacity-30" />
        <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full bg-ptt-green/5 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-ptt-green/3 blur-3xl" />
        {/* Горизонтальные линии сетки */}
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-full h-px bg-ptt-border/30"
            style={{ top: `${i * 5}%` }}
          />
        ))}
      </div>

      <div className="relative w-full max-w-sm">
        {/* Логотип */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ptt-card border border-ptt-border mb-4 relative">
            <Radio className="w-8 h-8 text-ptt-green" />
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-ptt-green animate-ping-slow" />
          </div>
          <h1 className="font-orbitron text-2xl font-bold text-white tracking-wider">
            PRIVOX<span className="text-ptt-green">PTT</span>
          </h1>
          <p className="font-mono text-ptt-text text-xs mt-1 tracking-widest">
            SECURE PUSH-TO-TALK SYSTEM
          </p>
        </div>

        {/* Форма */}
        <div className="card p-6 relative">
          {/* Угловые декоры */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-ptt-green" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-ptt-green" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-ptt-green" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-ptt-green" />

          <p className="font-mono text-ptt-text text-xs tracking-widest mb-6 text-center">
            &gt; SYSTEM AUTHORIZATION
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="font-mono text-ptt-text text-xs tracking-widest block mb-1">
                EMAIL / LOGIN
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                className="w-full bg-ptt-dark border border-ptt-border rounded px-3 py-2.5
                           font-mono text-sm text-white placeholder-ptt-muted
                           focus:outline-none focus:border-ptt-green focus:ring-1 focus:ring-ptt-green/30
                           transition-colors"
                placeholder="dispatch@company.com"
              />
            </div>

            <div>
              <label className="font-mono text-ptt-text text-xs tracking-widest block mb-1">
                PASSWORD
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-ptt-dark border border-ptt-border rounded px-3 py-2.5
                           font-mono text-sm text-white placeholder-ptt-muted
                           focus:outline-none focus:border-ptt-green focus:ring-1 focus:ring-ptt-green/30
                           transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-ptt-danger text-sm font-mono bg-ptt-danger/10 border border-ptt-danger/30 rounded px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-ptt-green text-ptt-dark font-orbitron font-bold text-sm
                         py-3 rounded tracking-widest uppercase
                         hover:bg-ptt-green/90 active:scale-95
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> SIGNING IN...</>
              ) : (
                'SIGN IN'
              )}
            </button>
          </form>
        </div>

        <p className="text-center font-mono text-ptt-muted text-xs mt-6 tracking-wider">
          ptt.privox.tech &nbsp;|&nbsp; v1.0.0
        </p>
      </div>
    </div>
  );
}
