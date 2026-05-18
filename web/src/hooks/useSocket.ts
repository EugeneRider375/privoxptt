import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useStore } from '@/store/useStore';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';
export const PRIVOX_SOCKET_READY_EVENT = 'privox-socket-ready';

let globalSocket: Socket | null = null;

export function getPrivoxSocket(): Socket | null {
  return globalSocket;
}

function publishSocket(socket: Socket): void {
  (window as any).__privoxSocket = socket;
  window.dispatchEvent(new CustomEvent(PRIVOX_SOCKET_READY_EVENT, { detail: socket }));
}

export function useSocket() {
  // Только токен нужен как реактивная зависимость
  const token = useStore((s) => s.accessToken);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    // Если сокет уже создан — просто переиспользуем (не создаём дубликаты)
    if (globalSocket) {
      socketRef.current = globalSocket;
      publishSocket(globalSocket);
      return;
    }

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    globalSocket = socket;
    socketRef.current = socket;
    publishSocket(socket);

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      const heartbeat = setInterval(() => socket.emit('heartbeat'), 30_000);
      socket.on('disconnect', () => clearInterval(heartbeat));
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    // Используем getState() вместо useStore() — не создаём лишние React-подписки
    socket.on('presence-snapshot', ({ users }: { users: Array<{ userId: string; callsign: string; displayName: string }> }) => {
      const state = useStore.getState();
      users.forEach((u) => state.setUserOnline(u.userId, u.callsign, u.displayName));
    });

    socket.on('user-online', ({ userId, callsign, displayName }) => {
      useStore.getState().setUserOnline(userId, callsign, displayName);
    });

    socket.on('user-offline', ({ userId }) => {
      useStore.getState().setUserOffline(userId);
    });

    socket.on('channel-busy', ({ groupId, userId, callsign }) => {
      const { user, setPttStatus, updateGroupPtt } = useStore.getState();
      if (userId !== user?.id) {
        setPttStatus('receiving', groupId, userId, callsign);
      }
      updateGroupPtt(groupId, userId);
    });

    socket.on('channel-free', ({ groupId }) => {
      const { pttGroupId, pttStatus, setPttStatus, updateGroupPtt } = useStore.getState();
      if (pttGroupId === groupId && pttStatus !== 'transmitting') {
        setPttStatus('idle');
      }
      updateGroupPtt(groupId, null);
    });

    socket.on('channel-locked', ({ message }) => {
      useStore.getState().addAlert({ type: 'warn', message });
    });

    socket.on('incoming-call', ({ fromCallsign, fromDisplayName }) => {
      useStore.getState().addAlert({
        type: 'info',
        callsign: fromCallsign,
        message: `Private call from ${fromCallsign} (${fromDisplayName})`,
      });
    });

    socket.on('user-location', (loc) => {
      useStore.getState().updateLocation(loc);
    });

    socket.on('sos-alert', ({ userId, callsign, message }) => {
      useStore.getState().addAlert({ type: 'sos', userId, callsign, message: `SOS: ${callsign} - ${message}` });
    });

    return () => {
      // Сокет глобальный — не отключаем
    };
  }, [token]);

  const joinGroup = useCallback((groupId: string) => {
    socketRef.current?.emit('join-group', { groupId });
  }, []);

  const leaveGroup = useCallback((groupId: string) => {
    socketRef.current?.emit('leave-group', { groupId });
  }, []);

  const pttStart = useCallback((groupId: string) => {
    return new Promise<void>((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket) {
        reject(new Error('Socket is not connected'));
        return;
      }

      socket.emit('ptt-start', { groupId }, (resp?: { ok: boolean; error?: string; message?: string }) => {
        if (resp?.ok) {
          resolve();
        } else {
          reject(new Error(resp?.message ?? resp?.error ?? 'PTT channel is unavailable'));
        }
      });
    });
  }, []);

  const pttStop = useCallback((groupId: string) => {
    socketRef.current?.emit('ptt-stop', { groupId });
  }, []);

  const sendLocation = useCallback((lat: number, lng: number, heading?: number, speed?: number) => {
    socketRef.current?.emit('location-update', { lat, lng, heading, speed, timestamp: Date.now() });
  }, []);

  const sendSos = useCallback((groupId: string, message = 'SOS!') => {
    socketRef.current?.emit('sos', { groupId, message });
  }, []);

  return { socket: socketRef.current, joinGroup, leaveGroup, pttStart, pttStop, sendLocation, sendSos };
}
