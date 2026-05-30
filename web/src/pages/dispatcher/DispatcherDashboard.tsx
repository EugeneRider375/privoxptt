import { useCallback, useEffect, useState } from 'react';
import { Radio, Mic, MicOff, PhoneCall, Check, Clock } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { PRIVOX_DATA_CHANGED_EVENT, useSocket } from '@/hooks/useSocket';
import { usePTT } from '@/hooks/usePTT';
import { groupsApi } from '@/api/client';
import { PTTButton } from '@/components/ui/PTTButton';
import { Waveform } from '@/components/ui/Waveform';
import type { Group, GroupMember } from '@/types';
import clsx from 'clsx';

export function DispatcherDashboard() {
  const groups = useStore((s) => s.groups);
  const setGroups = useStore((s) => s.setGroups);
  const activeGroupId = useStore((s) => s.activeGroupId);
  const setActiveGroup = useStore((s) => s.setActiveGroup);
  const pttStatus = useStore((s) => s.pttStatus);
  const pttCallsign = useStore((s) => s.pttCallsign);
  const onlineUsers = useStore((s) => s.onlineUsers);
  const dispatcherCalls = useStore((s) => s.dispatcherCalls);

  const user = useStore((s) => s.user);
  const { joinGroup, leaveGroup, acceptDispatcherCall, callUser } = useSocket();
  const { startPtt, stopPtt } = usePTT(activeGroupId);

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [callingUserId, setCallingUserId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  async function handleCallUser(targetUserId: string, callsign: string) {
    if (!activeGroupId || callingUserId) return;
    setCallingUserId(targetUserId);
    try {
      await callUser(targetUserId, activeGroupId);
      useStore.getState().addAlert({ type: 'info', callsign, message: `Call sent to ${callsign}` });
    } catch (err) {
      useStore.getState().addAlert({ type: 'warn', message: err instanceof Error ? err.message : 'Failed to call user' });
    } finally {
      setCallingUserId(null);
    }
  }

  const activeGroup = groups.find((g) => g.id === activeGroupId);

  const refreshGroups = useCallback(async () => {
    try {
      const g = await groupsApi.list();
      setGroups(g);
      if (!activeGroupId && g.length > 0) {
        setActiveGroup(g[0].id);
      }
      if (activeGroupId && !g.some((group: Group) => group.id === activeGroupId)) {
        setActiveGroup(g[0]?.id ?? '');
      }
    } catch (err) {
      console.error(err);
    }
  }, [activeGroupId, setActiveGroup, setGroups]);

  const refreshActiveGroup = useCallback(async () => {
    if (!activeGroupId) {
      setMembers([]);
      return;
    }

    try {
      const g = await groupsApi.get(activeGroupId);
      setMembers(g.members ?? []);
    } catch (err) {
      console.error(err);
    }
  }, [activeGroupId]);

  // Загружаем группы и сразу выбираем первую если не выбрано
  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  // Join/leave при смене активной группы
  useEffect(() => {
    if (!activeGroupId) return;

    joinGroup(activeGroupId);
    refreshActiveGroup();

    return () => { leaveGroup(activeGroupId); };
  }, [activeGroupId, joinGroup, leaveGroup, refreshActiveGroup]);

  useEffect(() => {
    const refresh = () => {
      refreshGroups();
      refreshActiveGroup();
    };

    window.addEventListener(PRIVOX_DATA_CHANGED_EVENT, refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener(PRIVOX_DATA_CHANGED_EVENT, refresh);
      window.clearInterval(timer);
    };
  }, [refreshActiveGroup, refreshGroups]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const pendingCalls = dispatcherCalls.filter((call) => call.status === 'pending');

  async function handleAcceptCall(callId: string) {
    const call = dispatcherCalls.find((item) => item.callId === callId);
    if (!call) return;

    setActiveGroup(call.groupId);
    try {
      await acceptDispatcherCall(call);
    } catch (err) {
      useStore.getState().addAlert({
        type: 'warn',
        message: err instanceof Error ? err.message : 'Failed to accept dispatcher call',
      });
    }
  }

  const onlineCount = Object.keys(onlineUsers).length;

  return (
    <div className="h-full grid grid-cols-[220px_1fr_220px] gap-0 overflow-hidden">

      {/* ── Левая панель: группы ───────────────────────────── */}
      <div className="bg-ptt-panel border-r border-ptt-border flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-ptt-border">
          <p className="font-mono text-ptt-text text-xs tracking-widest">CHANNELS</p>
        </div>
        {pendingCalls.length > 0 && (
          <div className="border-b border-ptt-border bg-ptt-dark">
            <div className="px-3 py-2 flex items-center gap-2">
              <PhoneCall className="w-3 h-3 text-ptt-blue animate-pulse" />
              <p className="font-mono text-ptt-blue text-xs tracking-widest">CALLS</p>
              <span className="ml-auto font-mono text-xs text-ptt-blue">{pendingCalls.length}</span>
            </div>
            <div className="max-h-44 overflow-y-auto">
              {pendingCalls.map((call) => {
                const waitSec = Math.max(0, Math.floor((now - call.createdAt) / 1000));
                return (
                  <div key={call.callId} className="px-3 py-2 border-t border-ptt-border/40">
                    <div className="flex items-center gap-2">
                      <span className="callsign text-xs truncate flex-1">{call.callsign}</span>
                      <span className="font-mono text-[10px] text-ptt-text flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {waitSec}s
                      </span>
                    </div>
                    <p className="font-rajdhani text-xs text-white truncate mt-0.5">{call.groupName}</p>
                    <button
                      onClick={() => handleAcceptCall(call.callId)}
                      className="mt-2 w-full flex items-center justify-center gap-1 border border-ptt-green/50 text-ptt-green hover:bg-ptt-green/10 rounded py-1 font-mono text-xs tracking-widest transition-colors"
                    >
                      <Check className="w-3 h-3" />
                      ACCEPT
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {groups.map((g) => {
            const busy = g.pttOwnerId != null;
            return (
              <button
                key={g.id}
                onClick={() => setActiveGroup(g.id)}
                className={clsx(
                  'w-full text-left px-3 py-3 border-b border-ptt-border/40 transition-colors',
                  g.id === activeGroupId
                    ? 'bg-ptt-green/10 border-l-2 border-l-ptt-green'
                    : 'hover:bg-ptt-muted/10'
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={clsx('w-2 h-2 rounded-full', busy ? 'animate-pulse' : '')}
                    style={{ backgroundColor: g.color }} />
                  <span className="font-rajdhani font-semibold text-sm text-white truncate flex-1">
                    {g.name}
                  </span>
                  {busy && <Mic className="w-3 h-3 text-ptt-green" />}
                </div>
                <p className="font-mono text-xs text-ptt-text mt-0.5 pl-4">
                  {g._count?.members ?? 0} members
                </p>
              </button>
            );
          })}
        </div>

        <div className="px-3 py-2 border-t border-ptt-border bg-ptt-dark">
          <div className="flex items-center gap-2">
            <div className="online-dot" />
            <span className="font-mono text-xs text-ptt-text">{onlineCount} online</span>
          </div>
        </div>
      </div>

      {/* ── Центр: PTT пульт ───────────────────────────────── */}
      <div className="flex flex-col overflow-hidden bg-ptt-dark">
        <div className="px-6 py-3 border-b border-ptt-border flex items-center gap-3">
          {activeGroup && (
            <>
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: activeGroup.color }} />
              <span className="font-rajdhani font-bold text-lg text-white">{activeGroup.name}</span>
              {activeGroup.pttOwnerId && (
                <span className="font-mono text-xs text-ptt-green bg-ptt-green/10 px-2 py-0.5 rounded">
                  BUSY
                </span>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-b border-ptt-border min-h-[72px] flex items-center gap-4">
          {pttStatus !== 'idle' ? (
            <>
              <div className={clsx(
                'w-3 h-3 rounded-full shrink-0',
                pttStatus === 'transmitting' ? 'bg-ptt-green animate-pulse' : 'bg-ptt-blue animate-pulse'
              )} />
              <div className="flex-1">
                <p className="callsign text-base">{pttCallsign ?? '???'}</p>
                <Waveform
                  active
                  bars={30}
                  color={pttStatus === 'transmitting' ? '#3DDC84' : '#4A9EFF'}
                  className="h-8"
                />
              </div>
              <span className="font-mono text-xs text-ptt-text">
                {pttStatus === 'transmitting' ? 'TRANSMITTING' : 'RECEIVING'}
              </span>
            </>
          ) : (
            <p className="font-mono text-ptt-text text-sm tracking-widest">● CHANNEL CLEAR</p>
          )}
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <PTTButton
              status={pttStatus}
              onStart={startPtt}
              onStop={stopPtt}
              size="lg"
            />
            <p className="font-mono text-ptt-text text-xs">
              Dispatcher · {activeGroup?.name ?? '-'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Правая панель: абоненты ─────────────────────────── */}
      <div className="bg-ptt-panel border-l border-ptt-border flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-ptt-border flex items-center justify-between">
          <p className="font-mono text-ptt-text text-xs tracking-widest">SUBSCRIBERS</p>
          <span className="font-mono text-xs text-ptt-green">
            {members.filter((m) => onlineUsers[m.userId]).length}/{members.length}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {members.map((m) => {
            const online = !!onlineUsers[m.userId];
            const talking = activeGroup?.pttOwnerId === m.userId;
            return (
              <div
                key={m.id}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2.5 border-b border-ptt-border/30',
                  talking && 'bg-ptt-green/5'
                )}
              >
                <div className={talking ? 'online-dot animate-pulse' : online ? 'online-dot' : 'offline-dot'} />
                <div className="flex-1 min-w-0">
                  <p className={clsx(
                    'callsign text-xs truncate',
                    !online && 'text-ptt-muted'
                  )}>
                    {m.user.callsign}
                  </p>
                  <p className="font-mono text-ptt-text text-xs truncate">{m.user.displayName}</p>
                </div>
                {talking && <Radio className="w-3 h-3 text-ptt-green shrink-0 animate-pulse" />}
                {!m.canSpeak && !talking && <MicOff className="w-3 h-3 text-ptt-muted shrink-0" />}
                {online && m.userId !== user?.id && (
                  <button
                    onClick={() => handleCallUser(m.userId, m.user.callsign)}
                    disabled={!!callingUserId}
                    title={`Call ${m.user.callsign}`}
                    className="shrink-0 p-1.5 rounded-md text-ptt-blue hover:bg-ptt-blue/10 disabled:opacity-40"
                  >
                    <PhoneCall className={clsx('w-4 h-4', callingUserId === m.userId && 'animate-pulse')} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-ptt-border p-2">
          <p className="font-mono text-ptt-muted text-xs tracking-widest mb-2">ALL ONLINE</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {Object.entries(onlineUsers).map(([uid, info]) => (
              <div key={uid} className="flex items-center gap-2 px-1">
                <div className="online-dot" />
                <span className="callsign text-xs">{info.callsign}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
