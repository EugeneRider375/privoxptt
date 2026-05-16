import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Group, UserLocation, Alert, PttStatus } from '@/types';

interface AppStore {
  // ─── Auth ──────────────────────────────────────────────
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: User, access: string, refresh: string) => void;
  clearAuth: () => void;

  // ─── Группы ────────────────────────────────────────────
  groups: Group[];
  activeGroupId: string | null;
  setGroups: (groups: Group[]) => void;
  setActiveGroup: (id: string) => void;
  updateGroupPtt: (groupId: string, ownerId: string | null) => void;

  // ─── PTT состояние ─────────────────────────────────────
  pttStatus: PttStatus;
  pttGroupId: string | null;
  pttUserId: string | null;
  pttCallsign: string | null;
  setPttStatus: (status: PttStatus, groupId?: string, userId?: string, callsign?: string) => void;

  // ─── Онлайн пользователи ───────────────────────────────
  onlineUsers: Record<string, { callsign: string; displayName: string }>;
  setUserOnline: (userId: string, callsign: string, displayName: string) => void;
  setUserOffline: (userId: string) => void;

  // ─── Местоположение ────────────────────────────────────
  locations: Record<string, UserLocation>;
  updateLocation: (loc: UserLocation) => void;

  // ─── Алерты ────────────────────────────────────────────
  alerts: Alert[];
  addAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'read'>) => void;
  markAlertRead: (id: string) => void;
  clearAlerts: () => void;

  // ─── UI ────────────────────────────────────────────────
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Auth
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) => {
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
        set({ user, accessToken, refreshToken });
      },
      clearAuth: () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        set({ user: null, accessToken: null, refreshToken: null });
      },

      // Группы
      groups: [],
      activeGroupId: null,
      setGroups: (groups) => set({ groups }),
      setActiveGroup: (id) => set({ activeGroupId: id }),
      updateGroupPtt: (groupId, ownerId) =>
        set((s) => ({
          groups: s.groups.map((g) =>
            g.id === groupId ? { ...g, pttOwnerId: ownerId } : g
          ),
        })),

      // PTT
      pttStatus: 'idle',
      pttGroupId: null,
      pttUserId: null,
      pttCallsign: null,
      setPttStatus: (pttStatus, pttGroupId, pttUserId, pttCallsign) =>
        set({ pttStatus, pttGroupId: pttGroupId ?? null, pttUserId: pttUserId ?? null, pttCallsign: pttCallsign ?? null }),

      // Онлайн
      onlineUsers: {},
      setUserOnline: (userId, callsign, displayName) =>
        set((s) => ({ onlineUsers: { ...s.onlineUsers, [userId]: { callsign, displayName } } })),
      setUserOffline: (userId) =>
        set((s) => {
          const next = { ...s.onlineUsers };
          delete next[userId];
          return { onlineUsers: next };
        }),

      // Местоположение
      locations: {},
      updateLocation: (loc) =>
        set((s) => ({ locations: { ...s.locations, [loc.userId]: loc } })),

      // Алерты
      alerts: [],
      addAlert: (alert) =>
        set((s) => ({
          alerts: [
            { ...alert, id: crypto.randomUUID(), timestamp: Date.now(), read: false },
            ...s.alerts.slice(0, 49), // храним последние 50
          ],
        })),
      markAlertRead: (id) =>
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)) })),
      clearAlerts: () => set({ alerts: [] }),

      // UI
      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    {
      name: 'privoxptt',
      skipHydration: true,
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        user: s.user,
        activeGroupId: s.activeGroupId,
        sidebarOpen: s.sidebarOpen,
      }),
    }
  )
);
