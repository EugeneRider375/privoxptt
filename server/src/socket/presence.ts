import { Server, Socket } from 'socket.io';
import { prisma } from '../database/prisma';
import { setUserOnline, setUserOffline, refreshUserOnline } from '../database/redis';
import { logger } from '../utils/logger';
import type { AuthenticatedSocket } from './index';

// Интервал heartbeat — клиент должен пинговать каждые 30 секунд
const HEARTBEAT_INTERVAL = 30_000;

export function setupPresence(io: Server, socket: AuthenticatedSocket): void {
  const { userId, callsign, displayName, organizationId } = socket.data;

  // Пользователь онлайн
  async function handleOnline() {
    await setUserOnline(userId, socket.id);
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeen: new Date() },
    });

    // Уведомляем всех в организации
    socket.to(`org:${organizationId}`).emit('user-online', {
      userId,
      callsign,
      displayName,
    });

    logger.debug({ msg: 'Пользователь онлайн', userId, callsign });
  }

  // Пользователь офлайн
  async function handleOffline() {
    await setUserOffline(userId);
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeen: new Date() },
    });

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
