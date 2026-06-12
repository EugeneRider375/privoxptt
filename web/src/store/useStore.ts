import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Group, UserLocation, Alert, PttStatus, DispatcherCall, DispatcherCallStatus, UserCallStatusEvent, SensorState } from '@/types';

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

  // В какой группе абонент находится прямо сейчас (для подсветки диспетчеру)
  userGroups: Record<string, string | null>;
  setUserGroup: (userId: string, groupId: string | null) => void;

  // ─── Местоположение ────────────────────────────────────
  locations: Record<string, UserLocation>;
  updateLocation: (loc: UserLocation) => void;

  // ─── Датчики ───────────────────────────────────────────
  sensors: Record<string, SensorState>;
  upsertSensor: (sensor: SensorState) => void;

  // ─── Алерты ────────────────────────────────────────────
  alerts: Alert[];
  addAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'read'>) => void;
  markAlertRead: (id: string) => void;
  clearAlerts: () => void;

  // ─── Вызовы диспетчера ──────────────────────────────────
  dispatcherCalls: DispatcherCall[];
  addDispatcherCall: (call: Omit<DispatcherCall, 'status'> & { status?: DispatcherCallStatus }) => void;
  updateDispatcherCall: (callId: string, patch: Partial<DispatcherCall>) => void;

  // ─── Исходящие пользовательские/групповые вызовы ────────
  outgoingUserCalls: UserCallStatusEvent[];
  updateOutgoingUserCall: (event: UserCallStatusEvent) => void;

  // ─── Сообщения ─────────────────────────────────────────
  unreadMessageCount: number;
  setUnreadMessageCount: (count: number) => void;
  incrementUnreadMessageCount: () => void;

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
        localStorage.removeItem('privoxptt');
        set({ user: null, accessToken: null, refreshToken: null, unreadMessageCount: 0 });
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
          const nextGroups = { ...s.userGroups };
          delete nextGroups[userId];
          return { onlineUsers: next, userGroups: nextGroups };
        }),

      // Текущая группа абонента
      userGroups: {},
      setUserGroup: (userId, groupId) =>
        set((s) => ({ userGroups: { ...s.userGroups, [userId]: groupId } })),

      // Местоположение
      locations: {},
      updateLocation: (loc) =>
        set((s) => ({ locations: { ...s.locations, [loc.userId]: loc } })),

      // Датчики
      sensors: {},
      upsertSensor: (sensor) =>
        set((s) => ({ sensors: { ...s.sensors, [sensor.id]: sensor } })),

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

      // Вызовы диспетчера
      dispatcherCalls: [],
      addDispatcherCall: (call) =>
        set((s) => {
          const nextCall: DispatcherCall = { ...call, status: call.status ?? 'pending' };
          const existing = s.dispatcherCalls.some((c) => c.callId === nextCall.callId);
          const calls = existing
            ? s.dispatcherCalls.map((c) => (c.callId === nextCall.callId ? { ...c, ...nextCall } : c))
            : [nextCall, ...s.dispatcherCalls];

          return {
            dispatcherCalls: calls
              .slice()
              .sort((a, b) => {
                const priorityOrder = { sos: 0, urgent: 1, normal: 2 };
                const priorityDelta = priorityOrder[a.priority] - priorityOrder[b.priority];
                return priorityDelta || a.createdAt - b.createdAt;
              })
              .slice(0, 25),
          };
        }),
      updateDispatcherCall: (callId, patch) =>
        set((s) => ({
          dispatcherCalls: s.dispatcherCalls.map((c) =>
            c.callId === callId ? { ...c, ...patch } : c
          ),
        })),

      // Исходящие пользовательские/групповые вызовы
      outgoingUserCalls: [],
      updateOutgoingUserCall: (event) =>
        set((s) => {
          const existing = s.outgoingUserCalls.some((call) => call.callId === event.callId);
          const calls = existing
            ? s.outgoingUserCalls.map((call) => call.callId === event.callId ? event : call)
            : [event, ...s.outgoingUserCalls];
          return { outgoingUserCalls: calls.slice(0, 100) };
        }),

      // Сообщения
      unreadMessageCount: 0,
      setUnreadMessageCount: (count) => set({ unreadMessageCount: Math.max(0, count) }),
      incrementUnreadMessageCount: () =>
        set((s) => ({ unreadMessageCount: s.unreadMessageCount + 1 })),

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
