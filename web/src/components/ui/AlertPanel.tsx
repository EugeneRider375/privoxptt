import { X, AlertTriangle, Info, Radio, PhoneCall } from 'lucide-react';
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

function UserCallAlert({ alert }: { alert: Alert }) {
  const markRead = useStore((s) => s.markAlertRead);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none p-4">
      <div className="pointer-events-auto w-full max-w-sm border border-ptt-blue/60 bg-ptt-dark/95 shadow-2xl shadow-ptt-blue/20 rounded p-5 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-ptt-blue/60 bg-ptt-blue/10">
          <PhoneCall className="h-7 w-7 text-ptt-blue animate-pulse" />
        </div>
        <p className="font-mono text-ptt-blue text-xs tracking-[0.25em]">INCOMING CALL</p>
        <p className="callsign text-xl mt-2">{alert.callsign ?? 'USER'}</p>
        <p className="font-rajdhani text-white text-lg mt-1">calls you in {alert.groupName ?? 'this group'}</p>
        <button
          onClick={() => markRead(alert.id)}
          className="mt-5 w-full border border-ptt-green/60 text-ptt-green font-mono text-xs tracking-widest rounded py-2 hover:bg-ptt-green/10 transition-colors"
        >
          OK
        </button>
      </div>
    </div>
  );
}

export function AlertPanel() {
  const allAlerts = useStore((s) => s.alerts);
  const alerts = allAlerts.filter((a) => !a.read && a.variant !== 'user-call');
  const userCall = allAlerts.find((a) => !a.read && a.variant === 'user-call');

  if (alerts.length === 0 && !userCall) return null;

  return (
    <>
      {userCall && <UserCallAlert alert={userCall} />}
      {alerts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 w-80 space-y-1 max-h-64 overflow-y-auto">
          {alerts.map((a) => <AlertItem key={a.id} alert={a} />)}
        </div>
      )}
    </>
  );
}
