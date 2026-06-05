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
      // Push a history entry so the hardware Back button (curved arrow) returns
      // to the groups list (like phones), and only minimizes the app at the
      // top level. Same path -> react-router stays on /radio.
      window.history.pushState({ radioView: 'members' }, '');
    },
    [setActiveGroup],
  );

  const goBackToGroups = useCallback(() => {
    // Use history.back so hardware Back and ←/Backspace behave identically.
    if (view === 'members') window.history.back();
  }, [view]);

  // Hardware Back / browser back -> return to groups list.
  useEffect(() => {
    const onPop = () => {
      setView('groups');
      setSelected(0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
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
    const isOnline = !!onlineUsers[m.userId];
    const isSelf = m.userId === user?.id;
    if (isOnline && !isSelf) onCallUser(m.userId);
  }, [view, groups, members, selected, onlineUsers, user?.id, enterGroup, onCallUser]);

  // D-pad / keyboard navigation. Space is reserved for PTT (handled in usePTT).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
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
  }, [count, view, activate, goBackToGroups]);

  // Keep the highlighted row visible on the tiny screen.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected, view]);

  const onlineCount = members.filter((m) => onlineUsers[m.userId]).length;
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
          <button onClick={onLogout} title="Log out" className="text-ptt-muted hover:text-white ml-1">
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
            const isOnline = !!onlineUsers[m.userId];
            const isTalking = activeGroup?.pttOwnerId === m.userId;
            const isSelf = m.userId === user?.id;
            const isCalling = callingUserId === m.userId;
            return (
              <div
                key={m.id}
                data-idx={idx}
                onClick={() => isOnline && !isSelf && onCallUser(m.userId)}
                className={`flex items-center gap-2 px-2 py-2 border-b border-ptt-border/30 cursor-pointer ${
                  sel ? 'bg-ptt-green/20' : ''
                }`}
              >
                <div className={isTalking ? 'online-dot animate-pulse' : isOnline ? 'online-dot' : 'offline-dot'} />
                <span className={`callsign text-sm truncate flex-1 ${isTalking ? 'text-ptt-green' : isOnline ? 'text-white' : 'text-ptt-muted'}`}>
                  {m.user.callsign}
                  {isSelf && <span className="text-ptt-muted text-[10px]"> (you)</span>}
                </span>
                {isTalking && <Radio className="w-3 h-3 text-ptt-green animate-pulse shrink-0" />}
                {!isTalking && !isSelf && isOnline && (
                  <PhoneCall className={`w-3.5 h-3.5 shrink-0 text-ptt-blue ${isCalling ? 'animate-pulse' : ''}`} />
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
    </div>
  );
}
