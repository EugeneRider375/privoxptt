import { useEffect, useState } from 'react';
import { Clock, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { activityApi } from '@/api/client';
import type { ActivityLogEntry, ActivityLogType } from '@/types';

const TYPE_LABEL: Record<ActivityLogType, string> = {
  USER_ONLINE: 'ONLINE',
  USER_OFFLINE: 'OFFLINE',
};

const TYPE_TEXT: Record<ActivityLogType, string> = {
  USER_ONLINE: 'entered the network',
  USER_OFFLINE: 'left the network',
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function ActivityLogPage() {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await activityApi.list({ limit: 150 });
      setLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-orbitron text-white text-base tracking-wider">ACTIVITY LOG</h2>
          <p className="font-mono text-ptt-muted text-xs mt-1">USER ONLINE / OFFLINE</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 bg-ptt-card border border-ptt-border text-ptt-text font-mono text-xs px-3 py-2 rounded hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          REFRESH
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ptt-border">
                <th className="text-left font-mono text-ptt-muted text-xs px-3 py-2 tracking-widest">TIME</th>
                <th className="text-left font-mono text-ptt-muted text-xs px-3 py-2 tracking-widest">EVENT</th>
                <th className="text-left font-mono text-ptt-muted text-xs px-3 py-2 tracking-widest">CALLSIGN</th>
                <th className="text-left font-mono text-ptt-muted text-xs px-3 py-2 tracking-widest">NAME</th>
                <th className="text-left font-mono text-ptt-muted text-xs px-3 py-2 tracking-widest">ORGANIZATION</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const online = log.type === 'USER_ONLINE';
                const Icon = online ? LogIn : LogOut;

                return (
                  <tr key={log.id} className="border-b border-ptt-border/30 hover:bg-ptt-muted/5">
                    <td className="px-3 py-2.5 font-mono text-ptt-text text-xs whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-ptt-muted" />
                        {formatTime(log.createdAt)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${online ? 'text-ptt-green' : 'text-ptt-muted'}`}>
                        <Icon className="w-3.5 h-3.5" />
                        {TYPE_LABEL[log.type]}
                      </span>
                      <span className="ml-2 font-rajdhani text-ptt-text text-xs">{TYPE_TEXT[log.type]}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="callsign text-sm">{log.callsign}</span>
                    </td>
                    <td className="px-3 py-2.5 font-rajdhani text-white">{log.displayName}</td>
                    <td className="px-3 py-2.5 font-mono text-ptt-muted text-xs">
                      {log.organization?.name ?? '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {logs.length === 0 && (
          <p className="text-center font-mono text-ptt-muted text-xs py-8">
            {loading ? 'LOADING...' : 'NO ACTIVITY YET'}
          </p>
        )}
      </div>
    </div>
  );
}
