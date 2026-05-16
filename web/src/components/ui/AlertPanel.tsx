import { X, AlertTriangle, Info, Radio } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '@/store/useStore';
import type { Alert } from '@/types';

const icons = {
  sos:   <Radio className="w-4 h-4 text-ptt-danger animate-blink" />,
  warn:  <AlertTriangle className="w-4 h-4 text-ptt-warn" />,
  error: <AlertTriangle className="w-4 h-4 text-ptt-danger" />,
  info:  <Info className="w-4 h-4 text-ptt-blue" />,
};

const colors = {
  sos:   'border-ptt-danger/50 bg-ptt-danger/10',
  warn:  'border-ptt-warn/40 bg-ptt-warn/10',
  error: 'border-ptt-danger/40 bg-ptt-danger/10',
  info:  'border-ptt-blue/30 bg-ptt-blue/5',
};

function AlertItem({ alert }: { alert: Alert }) {
  const markRead = useStore((s) => s.markAlertRead);

  return (
    <div className={clsx('flex items-start gap-2 p-2 rounded border font-mono text-xs', colors[alert.type])}>
      {icons[alert.type]}
      <div className="flex-1 min-w-0">
        {alert.callsign && (
          <span className="text-ptt-green tracking-widest mr-2">{alert.callsign}</span>
        )}
        <span className="text-white/80">{alert.message}</span>
      </div>
      <button
        onClick={() => markRead(alert.id)}
        className="text-ptt-muted hover:text-white shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function AlertPanel() {
  const allAlerts = useStore((s) => s.alerts);
  const alerts = allAlerts.filter((a) => !a.read);

  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 w-80 space-y-1 max-h-64 overflow-y-auto">
      {alerts.map((a) => <AlertItem key={a.id} alert={a} />)}
    </div>
  );
}
