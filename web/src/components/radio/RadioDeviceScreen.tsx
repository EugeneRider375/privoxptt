import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, Signal, Radio, PhoneCall, ChevronLeft, AlertTriangle } from 'lucide-react';
import type { Group, GroupMember, User, PttStatus } from '@/types';

// Compact, D-pad–navigable screen for the Inrico T320 radio (240x320).
// Reuses all data/handlers from UserRadioPage; only the layout differs.
// Navigation:
//   ↑/↓      move selection
//   Enter    groups view -> enter group (make active) -> members view
//            members view -> call selected online subscriber
//   ←/Back   members view -> back to groups
// Hardware PTT (side button) keeps working via the global Space handler in
// usePTT — talking always goes to the active group.

interface Props {
  user: User | null;
  groups: Group[];
  activeGroup: Group | undefined;
  activeGroupId: string | null;
  members: GroupMember[];
  onlineUsers: Record<string, { callsign: string; displayName: string }>;
  pttStatus: PttStatus;
  pttCallsign: string | null;
  callingUserId: string | null;
  setActiveGroup: (id: string) => void;
  onCallUser: (userId: string) => void;
  onSos: () => void;
  onLogout: () => void;
}

type View = 'groups' | 'members';

export function RadioDeviceScreen({
  user,
  groups,
  activeGroup,
  activeGroupId,
  members,
  onlineUsers,
  pttStatus,
  pttCallsign,
  callingUserId,
  setActiveGroup,
  onCallUser,
  onSos,
  onLogout,
}: Props) {
  const [view, setView] = useState<View>('groups');
  const [selected, setSelected] = useState(0);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const list = view === 'groups' ? groups : members;
  const count = list.length;

  // Keep selection in range when the list changes.
  useEffect(() => {
    setSelected((i) => (count === 0 ? 0 : Math.min(i, count - 1)));
  }, [count, view]);

  const enterGroup = useCallback(
    (g: Group) => {
      setActiveGroup(g.id);
      setView('members');
      setSelected(0);
    },
    [setActiveGroup],
  );

  const goBackToGroups = useCallback(() => {
    if (view === 'members') {
      setView('groups');
      setSelected(0);
    }
  }, [view]);

  // Expose a back handler for the native wrapper. The T320 hardware Back button
  // (curved arrow) is intercepted in MainActivity, which calls this: if we're
  // inside a group, step back to the groups list and report handled (true);
  // otherwise return false so the wrapper backgrounds the app. A ref keeps the
  // latest view without re-registering.
  const backRef = useRef<() => boolean>(() => false);
  backRef.current = () => {
    if (view === 'members') {
      setView('groups');
      setSelected(0);
      return true;
    }
    return false;
  };
  useEffect(() => {
    (window as unknown as { __privoxRadioBack?: () => boolean }).__privoxRadioBack = () =>
      backRef.current();
    return () => {
      delete (window as unknown as { __privoxRadioBack?: () => boolean }).__privoxRadioBack;
    };
  }, []);

  const activate = useCallback(() => {
    if (view === 'groups') {
      const g = groups[selected];
      if (g) enterGroup(g);
      return;
    }
    // members view: call the selected online subscriber (not self)
    const m = members[selected];
    if (!m) return;
    const isOnline = !!onlineUsers[m.userId] || !!m.isOnline;
    const isReachable = isOnline || !!m.isReachable;
    const isSelf = m.userId === user?.id;
    if (isReachable && !isSelf) onCallUser(m.userId);
  }, [view, groups, members, selected, onlineUsers, user?.id, enterGroup, onCallUser]);

  // D-pad / keyboard navigation. Space is reserved for PTT (handled in usePTT).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (confirmLogout) return; // overlay shown — ignore list navigation
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelected((i) => (count === 0 ? 0 : (i + 1) % count));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelected((i) => (count === 0 ? 0 : (i - 1 + count) % count));
          break;
        case 'Enter':
          e.preventDefault();
          activate();
          break;
        case 'ArrowLeft':
        case 'Backspace':
          if (view === 'members') {
            e.preventDefault();
            goBackToGroups();
          }
          break;
        case 'ArrowRight':
          if (view === 'groups') {
            e.preventDefault();
            activate();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, view, activate, goBackToGroups, confirmLogout]);

  // Keep the highlighted row visible on the tiny screen.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected, view]);

  const onlineCount = members.filter((m) => onlineUsers[m.userId] || m.isOnline).length;
  const transmitting = pttStatus === 'transmitting';
  const receiving = pttStatus === 'receiving';

  return (
    <div className="h-full flex flex-col bg-ptt-dark text-white select-none">
      {/* Top status bar */}
      <div className="flex items-center justify-between px-2 py-1 bg-ptt-panel border-b border-ptt-border text-xs">
        <div className="flex items-center gap-1 min-w-0">
          <div className="online-dot" />
          <span className="callsign truncate">{user?.callsign ?? '—'}</span>
        </div>
        <div className="flex items-center gap-1">
          <Signal className="w-3 h-3 text-ptt-green" />
          <button onClick={() => setConfirmLogout(true)} title="Log out" className="text-ptt-muted hover:text-white ml-1">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* View header */}
      <div className="flex items-center gap-1 px-2 py-1 bg-ptt-card border-b border-ptt-border">
        {view === 'members' && <ChevronLeft className="w-3.5 h-3.5 text-ptt-muted" />}
        <span className="font-mono text-[11px] tracking-widest text-ptt-text">
          {view === 'groups' ? 'GROUPS' : (activeGroup?.name ?? 'GROUP').toUpperCase()}
        </span>
        {view === 'members' && (
          <span className="ml-auto font-mono text-[11px] text-ptt-green">
            {onlineCount}/{members.length}
          </span>
        )}
      </div>

      {/* List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {view === 'groups' &&
          groups.map((g, idx) => {
            const sel = idx === selected;
            const isActive = g.id === activeGroupId;
            return (
              <div
                key={g.id}
                data-idx={idx}
                onClick={() => enterGroup(g)}
                className={`flex items-center gap-2 px-2 py-2 border-b border-ptt-border/40 cursor-pointer ${
                  sel ? 'bg-ptt-green/20' : ''
                }`}
              >
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                <div className="min-w-0 flex-1">
                  <p className={`font-rajdhani font-semibold text-sm leading-tight truncate ${isActive ? 'text-ptt-green' : 'text-white'}`}>
                    {g.name}
                  </p>
                  <p className="font-mono text-[10px] text-ptt-text leading-tight">
                    {g._count?.members ?? 0} members
                  </p>
                </div>
                {g.pttOwnerId && <Radio className="w-3 h-3 text-ptt-green animate-pulse shrink-0" />}
              </div>
            );
          })}

        {view === 'members' &&
          members.map((m, idx) => {
            const sel = idx === selected;
            const isOnline = !!onlineUsers[m.userId] || !!m.isOnline;
            const isReachable = isOnline || !!m.isReachable;
            const isTalking = activeGroup?.pttOwnerId === m.userId;
            const isSelf = m.userId === user?.id;
            const isCalling = callingUserId === m.userId;
            return (
              <div
                key={m.id}
                data-idx={idx}
                onClick={() => isReachable && !isSelf && onCallUser(m.userId)}
                className={`flex items-center gap-2 px-2 py-2 border-b border-ptt-border/30 cursor-pointer ${
                  sel ? 'bg-ptt-green/20' : ''
                }`}
              >
                <div className={
                  isTalking
                    ? 'online-dot animate-pulse'
                    : isOnline
                      ? 'online-dot'
                      : isReachable
                        ? 'w-2 h-2 rounded-full bg-ptt-blue'
                        : 'offline-dot'
                } />
                <span className={`callsign text-sm truncate flex-1 ${isTalking ? 'text-ptt-green' : isOnline ? 'text-white' : isReachable ? 'text-ptt-blue' : 'text-ptt-muted'}`}>
                  {m.user.callsign}
                  {isSelf && <span className="text-ptt-muted text-[10px]"> (you)</span>}
                </span>
                {isTalking && <Radio className="w-3 h-3 text-ptt-green animate-pulse shrink-0" />}
                {!isTalking && !isSelf && (
                  <PhoneCall className={`w-3.5 h-3.5 shrink-0 ${
                    isOnline ? 'text-ptt-green' : isReachable ? 'text-ptt-blue' : 'text-ptt-muted'
                  } ${isCalling ? 'animate-pulse' : ''}`} />
                )}
              </div>
            );
          })}

        {count === 0 && (
          <p className="font-mono text-[11px] text-ptt-muted text-center mt-6">
            {view === 'groups' ? 'NO GROUPS' : 'NO SUBSCRIBERS'}
          </p>
        )}
      </div>

      {/* Footer: active group + TX/RX state */}
      <div className="px-2 py-1 bg-ptt-panel border-t border-ptt-border flex items-center gap-2">
        <button onClick={onSos} title="SOS" className="text-ptt-danger shrink-0">
          <AlertTriangle className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0 text-center">
          {transmitting ? (
            <span className="font-mono text-[11px] text-ptt-green tracking-widest">● TRANSMITTING</span>
          ) : receiving ? (
            <span className="font-mono text-[11px] text-ptt-blue tracking-widest truncate">◀ {pttCallsign ?? ''}</span>
          ) : (
            <span className="font-mono text-[10px] text-ptt-muted truncate">
              PTT → {activeGroup?.name ?? '—'}
            </span>
          )}
        </div>
        <div className={`shrink-0 w-2 h-2 rounded-full ${transmitting ? 'bg-ptt-green animate-pulse' : receiving ? 'bg-ptt-blue animate-pulse' : 'bg-ptt-border'}`} />
      </div>

      {/* Logout confirmation — avoids accidental sign-out on the radio */}
      {confirmLogout && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 px-4">
          <p className="font-rajdhani font-bold text-white text-base">Log out?</p>
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmLogout(false)}
              className="px-4 py-2 border border-ptt-border rounded text-ptt-text font-mono text-xs tracking-widest"
            >
              CANCEL
            </button>
            <button
              onClick={onLogout}
              className="px-4 py-2 border border-ptt-danger/60 rounded text-ptt-danger font-mono text-xs tracking-widest"
            >
              LOG OUT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
