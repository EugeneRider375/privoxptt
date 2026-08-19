import { useCallback, useEffect, useState } from 'react';
import { LogOut, ChevronDown, Users, Radio, Signal, AlertTriangle, PhoneCall, MessageSquare, BatteryCharging, BatteryFull, BatteryMedium, BatteryLow, BatteryWarning } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/store/useStore';
import { PRIVOX_DATA_CHANGED_EVENT, disconnectPrivoxSocket, useSocket } from '@/hooks/useSocket';
import { usePTT } from '@/hooks/usePTT';
import { useGeolocation } from '@/hooks/useGeolocation';
import { groupsApi, authApi } from '@/api/client';
import { useBattery } from '@/hooks/useBattery';
import { unregisterNativePushDevice } from '@/hooks/useNativePush';
import { InstallAppHint } from '@/components/ui/InstallAppHint';
import { PTTButton } from '@/components/ui/PTTButton';
import { Waveform } from '@/components/ui/Waveform';
import { AlertPanel } from '@/components/ui/AlertPanel';
import { RadioDeviceScreen } from '@/components/radio/RadioDeviceScreen';
import { isRadioDevice } from '@/utils/device';
import type { Group, GroupMember } from '@/types';

export function UserRadioPage() {
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const unreadMessageCount = useStore((s) => s.unreadMessageCount);
  const groups = useStore((s) => s.groups);
  const setGroups = useStore((s) => s.setGroups);
  const activeGroupId = useStore((s) => s.activeGroupId);
  const setActiveGroup = useStore((s) => s.setActiveGroup);
  const pttStatus = useStore((s) => s.pttStatus);
  const pttCallsign = useStore((s) => s.pttCallsign);
  const clearAuth = useStore((s) => s.clearAuth);
  const onlineUsers = useStore((s) => s.onlineUsers);
  const userGroups = useStore((s) => s.userGroups);

  const battery = useBattery();
  const { joinGroup, leaveGroup, sendSos, callUser, callDispatcher } = useSocket();
  const { startPtt, stopPtt } = usePTT(activeGroupId);
  useGeolocation(true);

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [showGroups, setShowGroups] = useState(false);
  const [callingDispatcher, setCallingDispatcher] = useState(false);
  const [callingUserId, setCallingUserId] = useState<string | null>(null);

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

  async function handleLogout() {
    const rt = localStorage.getItem('refreshToken') ?? '';
    await unregisterNativePushDevice().catch(() => {});
    await authApi.logout(rt).catch(() => {});
    disconnectPrivoxSocket();
    clearAuth();
    window.location.href = '/login';
  }

  async function handleCallDispatcher() {
    if (!activeGroupId || callingDispatcher) return;
    setCallingDispatcher(true);
    try {
      await callDispatcher(activeGroupId);
    } catch (err) {
      useStore.getState().addAlert({
        type: 'warn',
        message: err instanceof Error ? err.message : 'Failed to call dispatcher',
      });
    } finally {
      setCallingDispatcher(false);
    }
  }

  async function handleCallUser(targetUserId: string) {
    if (!activeGroupId || callingUserId) return;
    setCallingUserId(targetUserId);
    try {
      await callUser(targetUserId, activeGroupId);
      const target = members.find((m) => m.userId === targetUserId);
      useStore.getState().addAlert({
        type: 'info',
        callsign: target?.user.callsign,
        message: `Call sent to ${target?.user.callsign ?? 'user'}`,
      });
    } catch (err) {
      useStore.getState().addAlert({
        type: 'warn',
        message: err instanceof Error ? err.message : 'Failed to call user',
      });
    } finally {
      setCallingUserId(null);
    }
  }

  const onlineCount = members.filter((m) => onlineUsers[m.userId] || m.isOnline).length;
  const isBusy = activeGroup?.pttOwnerId != null;

  // Inrico T320 radio: compact, D-pad–navigable layout. Same hooks/handlers
  // above keep running (incl. usePTT's hardware-PTT Space handler); only the
  // rendered layout differs. Phones fall through to the standard layout below.
  if (isRadioDevice()) {
    return (
      <>
        <AlertPanel />
        <RadioDeviceScreen
          user={user}
          groups={groups}
          activeGroup={activeGroup}
          activeGroupId={activeGroupId}
          members={members}
          onlineUsers={onlineUsers}
          pttStatus={pttStatus}
          pttCallsign={pttCallsign}
          callingUserId={callingUserId}
          setActiveGroup={setActiveGroup}
          onCallUser={handleCallUser}
          onSos={() => { if (activeGroupId) sendSos(activeGroupId); }}
          onLogout={handleLogout}
        />
      </>
    );
  }

  return (
    <div className="h-full flex flex-col bg-ptt-dark text-white max-w-md mx-auto relative">
      {/* Статус бар */}
      <div className="flex items-center justify-between px-4 py-2 bg-ptt-panel border-b border-ptt-border">
        <div className="flex items-center gap-2">
          <div className="online-dot" />
          <span className="callsign text-sm">{user?.callsign}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Signal className="w-3 h-3 text-ptt-green" />
          <span className="font-mono text-ptt-text text-xs">ONLINE</span>
          {battery.level !== null && (
            <>
              <span className="text-ptt-muted/40 text-xs">·</span>
              {battery.charging
                ? <BatteryCharging className="w-3.5 h-3.5 text-ptt-green" />
                : battery.level > 0.8
                  ? <BatteryFull className="w-3.5 h-3.5 text-ptt-green" />
                  : battery.level > 0.4
                    ? <BatteryMedium className="w-3.5 h-3.5 text-ptt-text" />
                    : battery.level > 0.2
                      ? <BatteryLow className="w-3.5 h-3.5 text-yellow-400" />
                      : <BatteryWarning className="w-3.5 h-3.5 text-ptt-danger" />
              }
              <span className={`font-mono text-xs ${battery.level <= 0.2 ? 'text-ptt-danger' : battery.level <= 0.4 ? 'text-yellow-400' : 'text-ptt-text'}`}>
                {Math.round(battery.level * 100)}%
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/messages')}
            title="Messages"
            className={`relative h-7 px-2 rounded border transition-colors flex items-center gap-1 ${
              unreadMessageCount > 0
                ? 'border-ptt-warn bg-ptt-warn/20 text-ptt-warn animate-pulse'
                : 'border-ptt-blue/60 bg-ptt-blue/10 text-ptt-blue hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="font-mono text-[10px]">CHAT</span>
            {unreadMessageCount > 0 && (
              <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-ptt-danger text-white font-mono text-[10px] flex items-center justify-center shadow-lg shadow-ptt-danger/40">
                {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
              </span>
            )}
          </button>
          <button
            onClick={handleCallDispatcher}
            disabled={!activeGroupId || callingDispatcher}
            title="Call dispatcher"
            className="text-ptt-blue hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PhoneCall className="w-4 h-4" />
          </button>
          <button onClick={handleLogout} className="text-ptt-muted hover:text-white transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Выбор канала */}
      <div className="relative">
        <button
          onClick={() => setShowGroups(!showGroups)}
          className="w-full flex items-center justify-between px-4 py-3 bg-ptt-card border-b border-ptt-border hover:bg-ptt-muted/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: activeGroup?.color ?? '#3DDC84' }}
            />
            <div className="text-left">
              <p className="font-rajdhani font-bold text-white text-sm leading-none">
                {activeGroup?.name ?? 'Select channel'}
              </p>
              <p className="font-mono text-ptt-text text-xs mt-0.5">
                {onlineCount} online · {members.length} total
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isBusy && <span className="w-2 h-2 rounded-full bg-ptt-green animate-pulse" />}
            <ChevronDown className={`w-4 h-4 text-ptt-muted transition-transform ${showGroups ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {showGroups && (
          <div className="absolute z-10 top-full left-0 right-0 bg-ptt-panel border border-ptt-border rounded-b-lg shadow-xl max-h-56 overflow-y-auto">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => { setActiveGroup(g.id); setShowGroups(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-ptt-muted/20 transition-colors border-b border-ptt-border/50 last:border-0 ${g.id === activeGroupId ? 'bg-ptt-green/10' : ''}`}
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />
                <div className="text-left flex-1">
                  <p className="font-rajdhani font-semibold text-sm text-white">{g.name}</p>
                  <p className="font-mono text-xs text-ptt-text">{g._count?.members ?? 0} members</p>
                </div>
                {g.pttOwnerId && <span className="w-2 h-2 rounded-full bg-ptt-green animate-pulse" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Кто говорит */}
      <div className="px-4 py-2 bg-ptt-dark border-b border-ptt-border min-h-[52px] flex items-center">
        {pttStatus !== 'idle' ? (
          <div className="flex items-center gap-3 w-full">
            <div className={`w-2 h-2 rounded-full ${pttStatus === 'transmitting' ? 'bg-ptt-green' : 'bg-ptt-blue'} animate-pulse`} />
            <div className="flex-1">
              <span className="callsign text-sm">{pttCallsign ?? user?.callsign}</span>
              <Waveform
                active={pttStatus === 'transmitting' || pttStatus === 'receiving'}
                bars={20}
                color={pttStatus === 'transmitting' ? '#3DDC84' : '#4A9EFF'}
                className="h-6"
              />
            </div>
          </div>
        ) : (
          <p className="font-mono text-ptt-muted text-xs tracking-widest">CHANNEL CLEAR</p>
        )}
      </div>

      {/* Вошёл по ссылке и остался в браузере — про приложение иначе не узнает. */}
      <InstallAppHint />

      {/* Центр — кнопка PTT */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
        <AlertPanel inline />

        <PTTButton
          status={pttStatus}
          onStart={startPtt}
          onStop={stopPtt}
          size="lg"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={handleCallDispatcher}
            disabled={!activeGroupId || callingDispatcher}
            className="flex items-center gap-2 px-4 py-2 border border-ptt-blue/50 rounded text-ptt-blue font-mono text-xs tracking-widest hover:bg-ptt-blue/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PhoneCall className="w-3 h-3" />
            {callingDispatcher ? 'CALLING' : 'DISPATCH'}
          </button>

          <button
            onClick={() => activeGroupId && sendSos(activeGroupId)}
            className="flex items-center gap-2 px-4 py-2 border border-ptt-danger/50 rounded text-ptt-danger font-mono text-xs tracking-widest hover:bg-ptt-danger/10 transition-colors"
          >
            <AlertTriangle className="w-3 h-3" />
            SOS
          </button>
        </div>
      </div>

      {/* Список участников */}
      <div className="border-t border-ptt-border bg-ptt-panel max-h-48 overflow-y-auto">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-ptt-border/50">
          <Users className="w-3 h-3 text-ptt-muted" />
          <span className="font-mono text-ptt-text text-xs tracking-widest">SUBSCRIBERS</span>
          <span className="ml-auto font-mono text-xs text-ptt-green">{onlineCount} / {members.length}</span>
        </div>

        {members.map((m) => {
          const isOnline = !!onlineUsers[m.userId] || !!m.isOnline;
          const isReachable = isOnline || !!m.isReachable;
          const isTalking = activeGroup?.pttOwnerId === m.userId;
          const isSelf = m.userId === user?.id;
          const isCalling = callingUserId === m.userId;
          // Онлайн, но сейчас в ДРУГОЙ группе → не услышит, если говорить в этой
          const currentGroupId = userGroups[m.userId];
          const inOtherGroup =
            isOnline && !isTalking && !isSelf &&
            currentGroupId != null && currentGroupId !== activeGroupId;
          const otherGroupName = inOtherGroup
            ? groups.find((g) => g.id === currentGroupId)?.name
            : undefined;
          return (
            <div key={m.id} className="flex items-center gap-3 px-4 py-2 border-b border-ptt-border/30 last:border-0">
              <div
                className={
                  isTalking
                    ? 'online-dot animate-pulse'
                    : inOtherGroup
                      ? 'w-2 h-2 rounded-full bg-ptt-warn'
                      : isOnline
                        ? 'online-dot'
                        : isReachable
                          ? 'w-2 h-2 rounded-full bg-ptt-blue'
                          : 'offline-dot'
                }
                title={inOtherGroup ? `In another group${otherGroupName ? `: ${otherGroupName}` : ''} — won't hear this channel` : isOnline ? 'Online' : isReachable ? 'Available by call' : 'Offline'}
              />
              <span className={`callsign text-sm ${isTalking ? 'text-ptt-green' : inOtherGroup ? 'text-ptt-warn' : isOnline ? 'text-white' : isReachable ? 'text-ptt-blue' : 'text-ptt-muted'}`}>
                {m.user.callsign}
                {otherGroupName && <span className="font-mono text-xs text-ptt-warn"> · {otherGroupName}</span>}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {isTalking && <Radio className="w-3 h-3 text-ptt-green animate-pulse" />}
                {!m.canSpeak && <span className="font-mono text-xs text-ptt-muted">LISTENER</span>}
                {!isTalking && !isSelf && (
                  <button
                    onClick={() => handleCallUser(m.userId)}
                    disabled={!isReachable || !!callingUserId}
                    className={`${isOnline ? 'text-ptt-green' : isReachable ? 'text-ptt-blue' : 'text-ptt-muted'} hover:text-white disabled:hover:text-ptt-muted disabled:cursor-not-allowed transition-colors`}
                    title={isReachable ? `Call ${m.user.callsign}` : `${m.user.callsign} is offline`}
                  >
                    <PhoneCall className={`w-3.5 h-3.5 ${isCalling ? 'animate-pulse' : ''}`} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
