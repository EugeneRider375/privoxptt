import { Server, Socket } from 'socket.io';
import { ActivityLogType } from '@prisma/client';
import { prisma } from '../database/prisma';
import { setUserOnline, setUserOffline, refreshUserOnline, getOnlineUserIds, isUserOnline } from '../database/redis';
import { logger } from '../utils/logger';
import type { AuthenticatedSocket } from './index';

// Интервал heartbeat — клиент должен пинговать каждые 30 секунд
const HEARTBEAT_INTERVAL = 30_000;

export function setupPresence(io: Server, socket: AuthenticatedSocket): void {
  const { userId, callsign, displayName, organizationId } = socket.data;

  async function writePresenceLog(type: ActivityLogType) {
    try {
      await prisma.activityLog.create({
        data: {
          type,
          organizationId,
          userId,
          callsign,
          displayName,
        },
      });
    } catch (err) {
      logger.error({ msg: 'Ошибка записи журнала присутствия', err, userId, type });
    }
  }

  // Пользователь онлайн
  async function handleOnline() {
    const wasOnline = await isUserOnline(userId);
    await setUserOnline(userId, socket.id);
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeen: new Date() },
    });

    if (!wasOnline) {
      await writePresenceLog(ActivityLogType.USER_ONLINE);
    }

    // Уведомляем всех остальных в организации
    socket.to(`org:${organizationId}`).emit('user-online', {
      userId,
      callsign,
      displayName,
    });

    // Отправляем новому сокету снапшот — кто уже онлайн
    const onlineIds = await getOnlineUserIds();
    if (onlineIds.length > 0) {
      const onlineUsers = await prisma.user.findMany({
        where: { id: { in: onlineIds }, organizationId },
        select: { id: true, callsign: true, displayName: true },
      });
      socket.emit('presence-snapshot', {
        users: onlineUsers.map((u) => ({
          userId: u.id,
          callsign: u.callsign,
          displayName: u.displayName,
        })),
      });
    }

    logger.debug({ msg: 'Пользователь онлайн', userId, callsign });
  }

  // Пользователь офлайн
  async function handleOffline() {
    const wentOffline = await setUserOffline(userId, socket.id);
    if (!wentOffline) return;

    await prisma.user.update({
      where: { id: userId },
      data: { lastSeen: new Date() },
    });

    await writePresenceLog(ActivityLogType.USER_OFFLINE);

    socket.to(`org:${organizationId}`).emit('user-offline', {
      userId,
      callsign,
    });

    logger.debug({ msg: 'Пользователь офлайн', userId, callsign });
  }

  // Heartbeat — обновляем TTL в Redis
  socket.on('heartbeat', async () => {
    await refreshUserOnline(userId);
    socket.emit('heartbeat-ack', { timestamp: Date.now() });
  });

  // Инициализируем статус
  handleOnline().catch((err) =>
    logger.error({ msg: 'Ошибка установки статуса онлайн', err })
  );

  socket.on('disconnect', () => {
    handleOffline().catch((err) =>
      logger.error({ msg: 'Ошибка установки статуса офлайн', err })
    );
  });
}
