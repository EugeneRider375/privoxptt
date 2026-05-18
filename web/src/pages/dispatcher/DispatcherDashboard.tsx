import { useEffect, useState } from 'react';
import { Radio, Mic, MicOff } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSocket } from '@/hooks/useSocket';
import { usePTT } from '@/hooks/usePTT';
import { groupsApi, usersApi } from '@/api/client';
import { PTTButton } from '@/components/ui/PTTButton';
import { Waveform } from '@/components/ui/Waveform';
import type { GroupMember, User } from '@/types';
import clsx from 'clsx';

export function DispatcherDashboard() {
  const groups = useStore((s) => s.groups);
  const setGroups = useStore((s) => s.setGroups);
  const activeGroupId = useStore((s) => s.activeGroupId);
  const setActiveGroup = useStore((s) => s.setActiveGroup);
  const pttStatus = useStore((s) => s.pttStatus);
  const pttCallsign = useStore((s) => s.pttCallsign);
  const onlineUsers = useStore((s) => s.onlineUsers);

  const { joinGroup, leaveGroup } = useSocket();
  const { startPtt, stopPtt } = usePTT(activeGroupId);

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);

  const activeGroup = groups.find((g) => g.id === activeGroupId);

  // Загружаем группы и сразу выбираем первую если не выбрано
  useEffect(() => {
    groupsApi.list().then((g) => {
      setGroups(g);
      if (!activeGroupId && g.length > 0) {
        setActiveGroup(g[0].id);
      }
    }).catch(console.error);

    usersApi.list().then(setAllUsers).catch(console.error);
  }, []);

  // Join/leave при смене активной группы
  useEffect(() => {
    if (!activeGroupId) return;

    joinGroup(activeGroupId);
    groupsApi.get(activeGroupId).then((g) => setMembers(g.members ?? [])).catch(console.error);

    return () => { leaveGroup(activeGroupId); };
  }, [activeGroupId]);

  const onlineCount = Object.keys(onlineUsers).length;

  return (
    <div className="h-full grid grid-cols-[220px_1fr_220px] gap-0 overflow-hidden">

      {/* ── Левая панель: группы ───────────────────────────── */}
      <div className="bg-ptt-panel border-r border-ptt-border flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-ptt-border">
          <p className="font-mono text-ptt-text text-xs tracking-widest">CHANNELS</p>
        </div>
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
