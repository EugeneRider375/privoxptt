import { useState } from 'react';
import { X, AlertTriangle, Info, Radio, PhoneCall, MessageSquare, Bell, ChevronDown, Thermometer } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '@/store/useStore';
import { respondToIncomingUserCall } from '@/hooks/useSocket';
import type { Alert } from '@/types';

const icons = {
  sos:    <Radio className="w-4 h-4 text-ptt-danger animate-blink" />,
  warn:   <AlertTriangle className="w-4 h-4 text-ptt-warn" />,
  error:  <AlertTriangle className="w-4 h-4 text-ptt-danger" />,
  info:   <Info className="w-4 h-4 text-ptt-blue" />,
  sensor: <Thermometer className="w-4 h-4 text-ptt-danger animate-blink" />,
};

const colors = {
  sos:    'border-ptt-danger/50 bg-ptt-danger/10',
  warn:   'border-ptt-warn/40 bg-ptt-warn/10',
  error:  'border-ptt-danger/40 bg-ptt-danger/10',
  info:   'border-ptt-blue/30 bg-ptt-blue/5',
  sensor: 'border-ptt-danger/50 bg-ptt-danger/10',
};

function AlertItem({ alert }: { alert: Alert }) {
  const markRead = useStore((s) => s.markAlertRead);
  const isMessage = alert.variant === 'message';

  return (
    <div className={clsx(
      'flex items-start gap-2 p-2 rounded border font-mono text-xs',
      isMessage
        ? 'border-ptt-warn bg-ptt-warn/20 shadow-lg shadow-ptt-warn/20'
        : colors[alert.type],
    )}>
      {isMessage ? <MessageSquare className="w-4 h-4 text-ptt-warn animate-pulse" /> : icons[alert.type]}
      <div className="flex-1 min-w-0">
        {alert.callsign && (
          <span className="text-ptt-green tracking-widest mr-2">{alert.callsign}</span>
        )}
        <span className="text-white/80">{alert.message}</span>
        <span className="block text-ptt-muted text-[10px] mt-0.5">
          {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
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
  const setActiveGroup = useStore((s) => s.setActiveGroup);

  const respond = async (status: 'answered' | 'declined') => {
    if (alert.callId) {
      await respondToIncomingUserCall(alert.callId, status).catch(() => {});
    }
    markRead(alert.id);
    // Групповой "будильник" — как раньше, просто заходим в канал группы.
    // Индивидуальный звонок (kind: 'user') никуда не редиректит — сервер
    // пришлёт отдельное событие call-connected, по которому откроется
    // ActiveCallScreen поверх текущего экрана.
    if (status === 'answered' && alert.groupId && alert.callKind === 'group') {
      setActiveGroup(alert.groupId);
      if (!window.location.pathname.startsWith('/radio')) {
        window.location.assign('/radio');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none p-4">
      <div className="pointer-events-auto w-full max-w-sm border border-ptt-blue/60 bg-ptt-dark/95 shadow-2xl shadow-ptt-blue/20 rounded p-5 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-ptt-blue/60 bg-ptt-blue/10">
          <PhoneCall className="h-7 w-7 text-ptt-blue animate-pulse" />
        </div>
        <p className="font-mono text-ptt-blue text-xs tracking-[0.25em]">
          {alert.callKind === 'group' ? 'GROUP CALL' : 'INCOMING CALL'}
        </p>
        <p className="callsign text-xl mt-2">{alert.callsign ?? 'USER'}</p>
        <p className="font-rajdhani text-white text-lg mt-1">calls you in {alert.groupName ?? 'this group'}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={() => respond('declined')}
            className="border border-ptt-danger/60 text-ptt-danger font-mono text-xs tracking-widest rounded py-2 hover:bg-ptt-danger/10 transition-colors"
          >
            DECLINE
          </button>
          <button
            onClick={() => respond('answered')}
            className="border border-ptt-green/60 text-ptt-green font-mono text-xs tracking-widest rounded py-2 hover:bg-ptt-green/10 transition-colors"
          >
            ANSWER
          </button>
        </div>
      </div>
    </div>
  );
}

export function AlertPanel({ inline = false, showCall = true, showNotifications = true }: { inline?: boolean; showCall?: boolean; showNotifications?: boolean }) {
  const allAlerts = useStore((s) => s.alerts);
  const alerts = allAlerts.filter((a) => !a.read && a.variant !== 'user-call');
  const userCall = allAlerts.find((a) => !a.read && a.variant === 'user-call');
  const [expanded, setExpanded] = useState(false);

  if (alerts.length === 0 && !userCall) return null;

  return (
    <>
      {showCall && userCall && <UserCallAlert alert={userCall} />}
      {showNotifications && alerts.length > 0 && (
        <div className={clsx(
          'z-50',
          inline ? 'relative w-[88%] max-w-sm' : 'fixed top-12 right-4 w-80 max-w-[calc(100vw-2rem)]',
        )}>
          <button
            onClick={() => setExpanded((value) => !value)}
            className={clsx(
              'w-full h-9 px-3 rounded border flex items-center gap-2 font-mono text-xs tracking-wider shadow-lg transition-colors',
              alerts.some((alert) => alert.variant === 'message')
                ? 'border-ptt-warn bg-ptt-warn/20 text-ptt-warn shadow-ptt-warn/10'
                : 'border-ptt-blue/50 bg-ptt-panel text-ptt-blue shadow-black/30',
            )}
          >
            <Bell className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">
              {alerts.length} {alerts.length === 1 ? 'NOTIFICATION' : 'NOTIFICATIONS'}
            </span>
            <ChevronDown className={clsx('w-4 h-4 transition-transform', expanded && 'rotate-180')} />
          </button>
          {expanded && (
            <div className={clsx(
              'mt-1 space-y-1 overflow-y-auto rounded bg-ptt-dark/95 p-1 border border-ptt-border shadow-2xl',
              inline ? 'absolute left-0 right-0 top-full max-h-52' : 'max-h-72',
            )}>
              {alerts.map((alert) => <AlertItem key={alert.id} alert={alert} />)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
