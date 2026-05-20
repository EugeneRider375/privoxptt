import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useStore } from '@/store/useStore';
import type { DispatcherCall } from '@/types';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';
const SOCKET_ACK_TIMEOUT_MS = 6_000;
export const PRIVOX_SOCKET_READY_EVENT = 'privox-socket-ready';
export const PRIVOX_DATA_CHANGED_EVENT = 'privox-data-changed';

let globalSocket: Socket | null = null;

export function getPrivoxSocket(): Socket | null {
  return globalSocket;
}

export function disconnectPrivoxSocket(): void {
  if (!globalSocket) return;
  globalSocket.removeAllListeners();
  globalSocket.disconnect();
  globalSocket = null;
  (window as any).__privoxSocket = null;
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
    if (!token) {
      disconnectPrivoxSocket();
      return;
    }

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

    socket.on('dispatcher-call-incoming', (call: Omit<DispatcherCall, 'status'>) => {
      const state = useStore.getState();
      state.addDispatcherCall({ ...call, status: 'pending' });
      state.addAlert({
        type: 'info',
        userId: call.fromUserId,
        callsign: call.callsign,
        message: `Dispatcher call from ${call.groupName}`,
      });
    });

    socket.on('dispatcher-call-sent', ({ groupName }: { groupName: string }) => {
      useStore.getState().addAlert({
        type: 'info',
        message: `Dispatcher call sent: ${groupName}`,
      });
    });

    socket.on('dispatcher-call-status', (event: {
      callId: string;
      groupId: string;
      fromUserId: string;
      status: DispatcherCall['status'];
      dispatcherId?: string;
      dispatcherCallsign?: string;
      answeredAt?: number;
    }) => {
      const state = useStore.getState();
      state.updateDispatcherCall(event.callId, event);
      if (event.status === 'answered') {
        const isCaller = state.user?.id === event.fromUserId;
        state.addAlert({
          type: 'info',
          callsign: event.dispatcherCallsign,
          message: isCaller
            ? 'Dispatcher accepted your call'
            : `Call answered by ${event.dispatcherCallsign ?? 'dispatcher'}`,
        });
      }
    });

    socket.on('org-data-changed', (event) => {
      window.dispatchEvent(new CustomEvent(PRIVOX_DATA_CHANGED_EVENT, { detail: event }));
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

  const callDispatcher = useCallback((groupId: string, message = 'Dispatcher requested') => {
    return new Promise<string>((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket) {
        reject(new Error('Socket is not connected'));
        return;
      }

      const timeout = window.setTimeout(() => {
        reject(new Error('Dispatcher call timed out'));
      }, SOCKET_ACK_TIMEOUT_MS);

      socket.emit('dispatcher-call-request', { groupId, message }, (resp?: { ok: boolean; callId?: string; error?: string; message?: string }) => {
        window.clearTimeout(timeout);
        if (resp?.ok && resp.callId) {
          resolve(resp.callId);
        } else {
          reject(new Error(resp?.message ?? resp?.error ?? 'Failed to call dispatcher'));
        }
      });
    });
  }, []);

  const acceptDispatcherCall = useCallback((call: DispatcherCall) => {
    return new Promise<void>((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket) {
        reject(new Error('Socket is not connected'));
        return;
      }

      const timeout = window.setTimeout(() => {
        reject(new Error('Accept call timed out'));
      }, SOCKET_ACK_TIMEOUT_MS);

      socket.emit('dispatcher-call-accept', {
        callId: call.callId,
        groupId: call.groupId,
        fromUserId: call.fromUserId,
      }, (resp?: { ok: boolean; error?: string; message?: string }) => {
        window.clearTimeout(timeout);
        if (resp?.ok) {
          resolve();
        } else {
          reject(new Error(resp?.message ?? resp?.error ?? 'Failed to accept dispatcher call'));
        }
      });
    });
  }, []);

  return {
    socket: socketRef.current,
    joinGroup,
    leaveGroup,
    pttStart,
    pttStop,
    sendLocation,
    sendSos,
    callDispatcher,
    acceptDispatcherCall,
  };
}
