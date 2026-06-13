import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useStore } from '@/store/useStore';
import type { ChatMessage, DispatcherCall, SensorState } from '@/types';
import { playUserCallTone } from '@/utils/callTone';
import { playMessageTone } from '@/utils/messageTone';
import { playSensorAlarm } from '@/utils/sensorAlarm';
import { messagesApi } from '@/api/client';
import { refetchSensors } from '@/utils/sensors';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';
const SOCKET_ACK_TIMEOUT_MS = 6_000;
export const PRIVOX_SOCKET_READY_EVENT = 'privox-socket-ready';
export const PRIVOX_DATA_CHANGED_EVENT = 'privox-data-changed';
export const PRIVOX_MESSAGE_NEW_EVENT = 'privox-message-new';
export const PRIVOX_MESSAGE_CLEARED_EVENT = 'privox-message-cleared';

let globalSocket: Socket | null = null;
// Heartbeat-вотчдог: следим за временем последнего heartbeat-ack от сервера.
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let lastPongAt = 0;

const HEARTBEAT_MS = 30_000;
const PONG_TIMEOUT_MS = 75_000; // нет ack ~2.5 пинга подряд → сокет «мёртв, но connected»

export function getPrivoxSocket(): Socket | null {
  return globalSocket;
}

export function disconnectPrivoxSocket(): void {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  if (!globalSocket) return;
  globalSocket.removeAllListeners();
  globalSocket.disconnect();
  globalSocket = null;
  (window as any).__privoxSocket = null;
}

export function respondToIncomingUserCall(
  callId: string,
  status: 'answered' | 'declined',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = getPrivoxSocket();
    if (!socket?.connected) {
      reject(new Error('Socket is not connected'));
      return;
    }
    socket.emit('user-call-response', { callId, status }, (resp?: { ok: boolean; error?: string }) => {
      if (resp?.ok) resolve();
      else reject(new Error(resp?.error ?? 'Unable to respond to call'));
    });
  });
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

    // Сервер отвечает heartbeat-ack на каждый наш heartbeat — фиксируем время ответа.
    lastPongAt = Date.now();
    socket.on('heartbeat-ack', () => { lastPongAt = Date.now(); });

    // Единый вотчдог-таймер на жизнь сокета. socket.io может остаться "connected",
    // но втихую перестать доставлять кадры (деградировавший сокет) — тогда reconnect
    // сам не наступает, presence-snapshot/sensor-update не приезжают, данные залипают
    // (лечилось только релогином). Если ack нет дольше PONG_TIMEOUT_MS → принудительный
    // реальный reconnect: он триггерит свежий presence-snapshot + рефетч датчиков.
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = setInterval(() => {
      if (!socket.connected) return; // отключён — реконнектом займётся сам socket.io
      socket.emit('heartbeat');
      if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
        console.warn('[Socket] heartbeat watchdog: нет ack, форсирую reconnect');
        lastPongAt = Date.now();        // не дёргать повторно на следующем тике
        socket.disconnect().connect();  // реальный reconnect → свежий снапшот
      }
    }, HEARTBEAT_MS);

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      lastPongAt = Date.now(); // свежее подключение — сбрасываем счётчик молчания
      messagesApi.conversations()
        .then((conversations: Array<{ unreadCount: number }>) => {
          const unread = conversations.reduce((total, item) => total + item.unreadCount, 0);
          useStore.getState().setUnreadMessageCount(unread);
        })
        .catch(() => {});
      // Реконсиляция датчиков: при reconnect могли пропустить sensor-update,
      // пока сокет был оторван (панель залипала в устаревшем состоянии). Сервер
      // на каждый connect заново заводит сокет в org-комнату, нам остаётся дотянуть
      // актуальный список. Срабатывает и на первый connect, и на каждый reconnect.
      void refetchSensors();
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    // Используем getState() вместо useStore() — не создаём лишние React-подписки
    socket.on('presence-snapshot', ({ users }: { users: Array<{ userId: string; callsign: string; displayName: string; currentGroupId?: string | null }> }) => {
      const state = useStore.getState();
      users.forEach((u) => {
        state.setUserOnline(u.userId, u.callsign, u.displayName);
        if (u.currentGroupId !== undefined) state.setUserGroup(u.userId, u.currentGroupId ?? null);
      });
    });

    socket.on('user-online', ({ userId, callsign, displayName }) => {
      useStore.getState().setUserOnline(userId, callsign, displayName);
    });

    socket.on('user-offline', ({ userId }) => {
      useStore.getState().setUserOffline(userId);
    });

    // Абонент сменил активную группу (или вышел из всех — groupId === null)
    socket.on('user-group-changed', ({ userId, groupId }: { userId: string; groupId: string | null }) => {
      useStore.getState().setUserGroup(userId, groupId);
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

    socket.on('user-call-incoming', ({
      fromUserId,
      fromCallsign,
      groupName,
      groupId,
      callId,
      kind,
    }: {
      callId: string;
      kind: 'user' | 'group';
      fromUserId: string;
      fromCallsign: string;
      fromDisplayName: string;
      groupId: string;
      groupName: string;
      createdAt: number;
    }) => {
      useStore.getState().addAlert({
        type: 'info',
        variant: 'user-call',
        userId: fromUserId,
        callsign: fromCallsign,
        groupName,
        groupId,
        callId,
        callKind: kind,
        message: `${fromCallsign} calls you in ${groupName}`,
      });
      playUserCallTone().catch((err) => {
        console.warn('[Socket] User call tone blocked:', err);
      });
    });

    socket.on('user-call-status', (event) => {
      const state = useStore.getState();
      state.updateOutgoingUserCall(event);
      if (event.kind === 'user' && event.status !== 'ringing') {
        const label = event.status === 'answered'
          ? 'answered'
          : event.status === 'declined'
            ? 'declined'
            : 'did not answer';
        state.addAlert({
          type: event.status === 'answered' ? 'info' : 'warn',
          callsign: event.targetCallsign,
          message: `${event.targetCallsign} ${label}`,
        });
      }
    });

    socket.on('user-location', (loc) => {
      useStore.getState().updateLocation(loc);
    });

    socket.on('sos-alert', ({ userId, callsign, message }) => {
      useStore.getState().addAlert({ type: 'sos', userId, callsign, message: `SOS: ${callsign} - ${message}` });
    });

    // ─── Датчики: живое значение (всегда) ───────────────────
    socket.on('sensor-update', (s: SensorState) => {
      useStore.getState().upsertSensor(s);
    });

    // ─── Датчики: тревога (на переходе OK→ALERT/STALE) ──────
    socket.on('sensor-alert', (a: {
      sensorId: string;
      name: string;
      kind: SensorState['kind'];
      status: 'ALERT' | 'STALE';
      message: string;
      metrics?: Record<string, number | boolean>;
      temperature: number | null;
      humidity: number | null;
      groupId: string | null;
      lat: number | null;
      lng: number | null;
      at: string;
    }) => {
      const state = useStore.getState();
      state.upsertSensor({
        id: a.sensorId,
        name: a.name,
        kind: a.kind,
        status: a.status,
        metrics: a.metrics,
        temperature: a.temperature,
        humidity: a.humidity,
        lat: a.lat,
        lng: a.lng,
        lastSeenAt: a.at,
      });
      state.addAlert({
        type: 'sensor',
        message: `${a.name}: ${a.message}`,
        groupId: a.groupId ?? undefined,
      });
      // Звуковая сирена только диспетчеру/админу/суперадмину (у них пульт мониторинга).
      const role = state.user?.role;
      if (role === 'DISPATCHER' || role === 'ADMIN' || role === 'SUPERADMIN') {
        void playSensorAlarm();
      }
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

    socket.on('message:new', (message: ChatMessage) => {
      window.dispatchEvent(new CustomEvent(PRIVOX_MESSAGE_NEW_EVENT, { detail: message }));
      if (message.senderId !== useStore.getState().user?.id) {
        const state = useStore.getState();
        state.incrementUnreadMessageCount();
        state.addAlert({
          type: 'info',
          variant: 'message',
          callsign: message.sender.callsign,
          message: `New message: ${(message.attachment?.name ?? message.body).slice(0, 80)}`,
        });
        playMessageTone().catch((err) => {
          console.warn('[Socket] Message tone blocked:', err);
        });
      }
    });

    socket.on('message:cleared', (event: { groupId?: string; userId?: string }) => {
      window.dispatchEvent(new CustomEvent(PRIVOX_MESSAGE_CLEARED_EVENT, { detail: event }));
      messagesApi.conversations()
        .then((conversations: Array<{ unreadCount: number }>) => {
          const unread = conversations.reduce((total, item) => total + item.unreadCount, 0);
          useStore.getState().setUnreadMessageCount(unread);
        })
        .catch(() => {});
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

  const callUser = useCallback((targetUserId: string, groupId: string) => {
    return new Promise<{ callId?: string }>((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket) {
        reject(new Error('Socket is not connected'));
        return;
      }

      const timeout = window.setTimeout(() => {
        reject(new Error('User call timed out'));
      }, SOCKET_ACK_TIMEOUT_MS);

      socket.emit('user-call-request', { targetUserId, groupId }, (resp?: { ok: boolean; callId?: string; error?: string; message?: string }) => {
        window.clearTimeout(timeout);
        if (resp?.ok) {
          resolve({ callId: resp.callId });
        } else {
          reject(new Error(resp?.message ?? resp?.error ?? 'Failed to call user'));
        }
      });
    });
  }, []);

  const wakeGroup = useCallback((groupId: string) => {
    return new Promise<{
      campaignId: string;
      total: number;
      delivered: number;
      unreachable: number;
    }>((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket) {
        reject(new Error('Socket is not connected'));
        return;
      }

      const timeout = window.setTimeout(() => reject(new Error('Group call timed out')), 20_000);
      socket.emit('group-call-request', { groupId }, (resp?: {
        ok: boolean;
        campaignId?: string;
        total?: number;
        delivered?: number;
        unreachable?: number;
        error?: string;
        message?: string;
      }) => {
        window.clearTimeout(timeout);
        if (resp?.ok && resp.campaignId) {
          resolve({
            campaignId: resp.campaignId,
            total: resp.total ?? 0,
            delivered: resp.delivered ?? 0,
            unreachable: resp.unreachable ?? 0,
          });
        } else {
          reject(new Error(resp?.message ?? resp?.error ?? 'Failed to call group'));
        }
      });
    });
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
    callUser,
    wakeGroup,
    callDispatcher,
    acceptDispatcherCall,
  };
}
