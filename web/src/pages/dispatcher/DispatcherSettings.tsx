import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { usersApi } from '@/api/client';
import { CheckCircle, AlertCircle } from 'lucide-react';

export function DispatcherSettings() {
  const user = useStore((s) => s.user);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setMsg(null);
    try {
      await usersApi.changePassword(user.id, currentPassword, newPassword);
      setMsg({ type: 'ok', text: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setMsg({ type: 'err', text: err?.response?.data?.error ?? 'Error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-md">
      <h2 className="font-orbitron text-white text-lg mb-6">SETTINGS</h2>

      <div className="card p-4 space-y-4">
        <p className="font-mono text-ptt-text text-xs tracking-widest border-b border-ptt-border pb-2">
          PROFILE
        </p>
        <div className="space-y-1">
          <p className="font-mono text-xs text-ptt-muted">CALLSIGN</p>
          <p className="callsign">{user?.callsign}</p>
        </div>
        <div className="space-y-1">
          <p className="font-mono text-xs text-ptt-muted">EMAIL</p>
          <p className="font-mono text-sm text-white">{user?.email}</p>
        </div>
        <div className="space-y-1">
          <p className="font-mono text-xs text-ptt-muted">ROLE</p>
          <p className="font-mono text-sm text-ptt-green">{user?.role}</p>
        </div>
      </div>

      <div className="card p-4 mt-4 space-y-4">
        <p className="font-mono text-ptt-text text-xs tracking-widest border-b border-ptt-border pb-2">
          CHANGE PASSWORD
        </p>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="font-mono text-xs text-ptt-muted block mb-1">CURRENT PASSWORD</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full bg-ptt-dark border border-ptt-border rounded px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-ptt-green"
            />
          </div>
          <div>
            <label className="font-mono text-xs text-ptt-muted block mb-1">NEW PASSWORD</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full bg-ptt-dark border border-ptt-border rounded px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-ptt-green"
            />
          </div>
          {msg && (
            <div className={`flex items-center gap-2 text-xs font-mono ${msg.type === 'ok' ? 'text-ptt-green' : 'text-ptt-danger'}`}>
              {msg.type === 'ok' ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
              {msg.text}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest disabled:opacity-50"
          >
            {loading ? 'SAVING...' : 'SAVE'}
          </button>
        </form>
      </div>
    </div>
  );
}
