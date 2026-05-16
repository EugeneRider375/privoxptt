import { Server } from 'socket.io';
import { prisma } from '../database/prisma';
import {
  acquirePttLock,
  releasePttLock,
  getPttLockOwner,
  redis,
  PTT_LOCK_PREFIX,
} from '../database/redis';
import { logger } from '../utils/logger';
import type { AuthenticatedSocket } from './index';

export function setupPtt(io: Server, socket: AuthenticatedSocket): void {
  const { userId, callsign, displayName, organizationId, role } = socket.data;

  // ─── Присоединиться к группе ──────────────────────────────
  socket.on('join-group', async ({ groupId }: { groupId: string }) => {
    try {
      // Проверяем что пользователь состоит в группе
      const member = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
        include: { group: { select: { organizationId: true } } },
      });

      // Диспетчер и admin могут входить в любую группу своей организации
      const isPrivileged = ['SUPERADMIN', 'ADMIN', 'DISPATCHER'].includes(role);

      if (!isPrivileged) {
        if (!member) {
          socket.emit('error', { code: 'NOT_MEMBER', message: 'Вы не состоите в этой группе' });
          return;
        }
      } else {
        // Проверяем что группа принадлежит организации
        const group = await prisma.group.findFirst({
          where: { id: groupId, organizationId },
        });
        if (!group && role !== 'SUPERADMIN') {
          socket.emit('error', { code: 'FORBIDDEN', message: 'Доступ запрещён' });
          return;
        }
      }

      socket.join(groupId);
      logger.debug({ msg: 'Вошёл в группу', userId, callsign, groupId });

      // Сообщаем текущий статус PTT в группе
      const lockOwner = await getPttLockOwner(groupId);
      if (lockOwner) {
        const owner = await prisma.user.findUnique({
          where: { id: lockOwner },
          select: { callsign: true, displayName: true },
        });
        socket.emit('channel-busy', {
          groupId,
          userId: lockOwner,
          callsign: owner?.callsign ?? '???',
          displayName: owner?.displayName ?? '???',
        });
      } else {
        socket.emit('channel-free', { groupId });
      }
    } catch (err) {
      logger.error({ msg: 'Ошибка join-group', err, userId, groupId });
    }
  });

  // ─── Покинуть группу ──────────────────────────────────────
  socket.on('leave-group', async ({ groupId }: { groupId: string }) => {
    // Если этот пользователь держал PTT — освобождаем
    await releasePttLock(groupId, userId);
    socket.leave(groupId);
    logger.debug({ msg: 'Покинул группу', userId, callsign, groupId });
  });

  // ─── PTT нажата ───────────────────────────────────────────
  socket.on('ptt-start', async ({ groupId }: { groupId: string }) => {
    try {
      // Проверяем canSpeak
      const member = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      });

      const isPrivileged = ['SUPERADMIN', 'ADMIN', 'DISPATCHER'].includes(role);
      if (!isPrivileged && member && !member.canSpeak) {
        socket.emit('channel-locked', {
          groupId,
          reason: 'no_speak_permission',
          message: 'Вам запрещено говорить в этой группе',
        });
        return;
      }

      const acquired = await acquirePttLock(groupId, userId);

      if (!acquired) {
        const lockOwner = await getPttLockOwner(groupId);
        const owner = lockOwner
          ? await prisma.user.findUnique({
              where: { id: lockOwner },
              select: { callsign: true },
            })
          : null;

        socket.emit('channel-locked', {
          groupId,
          lockedBy: lockOwner,
          lockedByCallsign: owner?.callsign ?? '???',
          reason: 'channel_busy',
          message: 'Канал занят',
        });
        return;
      }

      // Канал захвачен — уведомляем всех в группе
      io.to(groupId).emit('channel-busy', {
        groupId,
        userId,
        callsign,
        displayName,
      });

      logger.info({ msg: 'PTT start', userId, callsign, groupId });
    } catch (err) {
      logger.error({ msg: 'Ошибка ptt-start', err, userId, groupId });
    }
  });

  // ─── PTT отпущена ─────────────────────────────────────────
  socket.on('ptt-stop', async ({ groupId }: { groupId: string }) => {
    try {
      const released = await releasePttLock(groupId, userId);

      if (released) {
        io.to(groupId).emit('channel-free', { groupId });
        logger.info({ msg: 'PTT stop', userId, callsign, groupId });
      }
    } catch (err) {
      logger.error({ msg: 'Ошибка ptt-stop', err, userId, groupId });
    }
  });

  // ─── Личный вызов ─────────────────────────────────────────
  socket.on('private-call-start', async ({ targetUserId }: { targetUserId: string }) => {
    try {
      const target = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { callsign: true, displayName: true },
      });

      if (!target) {
        socket.emit('error', { code: 'NOT_FOUND', message: 'Пользователь не найден' });
        return;
      }

      io.to(`user:${targetUserId}`).emit('incoming-call', {
        fromId: userId,
        fromCallsign: callsign,
        fromDisplayName: displayName,
      });

      logger.info({ msg: 'Личный вызов', from: userId, to: targetUserId });
    } catch (err) {
      logger.error({ msg: 'Ошибка private-call-start', err });
    }
  });

  socket.on('private-call-end', async ({ targetUserId }: { targetUserId: string }) => {
    io.to(`user:${targetUserId}`).emit('call-ended', { fromId: userId });
  });

  // ─── WebRTC сигналинг ─────────────────────────────────────
  socket.on('webrtc-offer', ({ targetId, sdp }: { targetId: string; sdp: object }) => {
    io.to(`user:${targetId}`).emit('webrtc-offer', { fromId: userId, sdp });
  });

  socket.on('webrtc-answer', ({ targetId, sdp }: { targetId: string; sdp: object }) => {
    io.to(`user:${targetId}`).emit('webrtc-answer', { fromId: userId, sdp });
  });

  socket.on('webrtc-ice', ({ targetId, candidate }: { targetId: string; candidate: object }) => {
    io.to(`user:${targetId}`).emit('webrtc-ice', { fromId: userId, candidate });
  });

  // ─── GPS местоположение ───────────────────────────────────
  socket.on('location-update', (data: {
    lat: number; lng: number;
    heading?: number; speed?: number; timestamp: number;
  }) => {
    // Рассылаем диспетчерам и администраторам в организации
    socket.to(`org:${organizationId}`).emit('user-location', {
      userId,
      callsign,
      lat: data.lat,
      lng: data.lng,
      heading: data.heading,
      speed: data.speed,
      timestamp: data.timestamp,
    });
  });

  // ─── SOS алерт ────────────────────────────────────────────
  socket.on('sos', async ({ groupId, message }: { groupId: string; message: string }) => {
    logger.warn({ msg: 'SOS!', userId, callsign, groupId });
    // Рассылаем всем в группе и в организации
    io.to(groupId).emit('sos-alert', { userId, callsign, groupId, message });
    socket.to(`org:${organizationId}`).emit('sos-alert', { userId, callsign, groupId, message });
  });

  // ─── Очистка при дисконнекте ──────────────────────────────
  socket.on('disconnect', async () => {
    // Освобождаем все PTT блокировки этого пользователя
    const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
    for (const groupId of rooms) {
      const released = await releasePttLock(groupId, userId);
      if (released) {
        io.to(groupId).emit('channel-free', { groupId });
      }
    }
  });
}
