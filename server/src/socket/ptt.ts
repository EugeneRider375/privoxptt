import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import { prisma } from '../database/prisma';
import {
  acquirePttLock,
  releasePttLock,
  refreshPttLock,
  getPttLockOwner,
  redis,
  PTT_LOCK_PREFIX,
} from '../database/redis';
import { logger } from '../utils/logger';
import type { AuthenticatedSocket } from './index';

export function setupPtt(io: Server, socket: AuthenticatedSocket): void {
  const { userId, callsign, displayName, organizationId, role } = socket.data;
  const heldPttGroups = new Set<string>();
  const isPrivileged = ['SUPERADMIN', 'ADMIN', 'DISPATCHER'].includes(role);

  const canAccessGroup = async (groupId: string) => {
    const member = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: { select: { id: true, name: true, organizationId: true } } },
    });

    if (member && member.group.organizationId === organizationId) {
      return { ok: true, group: member.group, member };
    }

    if (isPrivileged) {
      const group = await prisma.group.findFirst({
        where: { id: groupId, organizationId },
        select: { id: true, name: true, organizationId: true },
      });
      if (group || role === 'SUPERADMIN') {
        return { ok: !!group, group, member };
      }
    }

    return { ok: false, group: null, member };
  };
  const refreshHeldLocks = async () => {
    for (const groupId of heldPttGroups) {
      const refreshed = await refreshPttLock(groupId, userId);
      if (!refreshed) heldPttGroups.delete(groupId);
    }
  };
  const pttRefreshTimer = setInterval(() => {
    refreshHeldLocks().catch((err) => logger.error({ msg: 'PTT lock refresh failed', err, userId }));
  }, 3_000);

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
          socket.emit('error', { code: 'NOT_MEMBER', message: 'You are not a member of this group' });
          return;
        }
      } else {
        // Проверяем что группа принадлежит организации
        const group = await prisma.group.findFirst({
          where: { id: groupId, organizationId },
        });
        if (!group && role !== 'SUPERADMIN') {
          socket.emit('error', { code: 'FORBIDDEN', message: 'Access denied' });
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
    heldPttGroups.delete(groupId);
    socket.leave(groupId);
    logger.debug({ msg: 'Покинул группу', userId, callsign, groupId });
  });

  // ─── PTT нажата ───────────────────────────────────────────
  socket.on('ptt-start', async (
    { groupId }: { groupId: string },
    callback?: (data: { ok: boolean; error?: string; message?: string }) => void
  ) => {
    try {
      // Проверяем canSpeak
      const member = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      });

      const isPrivileged = ['SUPERADMIN', 'ADMIN', 'DISPATCHER'].includes(role);
      if (!isPrivileged && member && !member.canSpeak) {
        callback?.({ ok: false, error: 'no_speak_permission', message: 'You are not allowed to speak in this group' });
        socket.emit('channel-locked', {
          groupId,
          reason: 'no_speak_permission',
          message: 'You are not allowed to speak in this group',
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
          message: 'Channel busy',
        });
        callback?.({ ok: false, error: 'channel_busy', message: 'Channel busy' });
        return;
      }

      heldPttGroups.add(groupId);

      // Канал захвачен — уведомляем всех в группе
      io.to(groupId).emit('channel-busy', {
        groupId,
        userId,
        callsign,
        displayName,
      });

      callback?.({ ok: true });
      logger.info({ msg: 'PTT start', userId, callsign, groupId });
    } catch (err) {
      logger.error({ msg: 'Ошибка ptt-start', err, userId, groupId });
      callback?.({ ok: false, error: 'server_error', message: 'Failed to acquire PTT channel' });
    }
  });

  // ─── PTT отпущена ─────────────────────────────────────────
  socket.on('ptt-stop', async ({ groupId }: { groupId: string }) => {
    try {
      const released = await releasePttLock(groupId, userId);
      heldPttGroups.delete(groupId);

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
        socket.emit('error', { code: 'NOT_FOUND', message: 'User not found' });
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

  // ─── Вызов диспетчера ─────────────────────────────────────
  socket.on('dispatcher-call-request', async (
    { groupId, message }: { groupId: string; message?: string },
    callback?: (data: { ok: boolean; callId?: string; error?: string; message?: string }) => void
  ) => {
    try {
      const access = await canAccessGroup(groupId);
      if (!access.ok || !access.group) {
        callback?.({ ok: false, error: 'forbidden', message: 'Access denied' });
        socket.emit('dispatcher-call-error', { groupId, message: 'Access denied' });
        return;
      }

      const callId = randomUUID();
      const payload = {
        callId,
        groupId,
        groupName: access.group.name,
        fromUserId: userId,
        callsign,
        displayName,
        message: message?.trim() || 'Dispatcher requested',
        priority: 'normal' as const,
        createdAt: Date.now(),
      };

      io.to(`org:${organizationId}:dispatchers`).emit('dispatcher-call-incoming', payload);
      socket.emit('dispatcher-call-sent', payload);
      callback?.({ ok: true, callId });
      logger.info({ msg: 'Dispatcher call requested', userId, callsign, groupId, callId });
    } catch (err) {
      logger.error({ msg: 'Ошибка dispatcher-call-request', err, userId, groupId });
      callback?.({ ok: false, error: 'server_error', message: 'Failed to call dispatcher' });
    }
  });

  socket.on('dispatcher-call-accept', async (
    { callId, groupId, fromUserId }: { callId: string; groupId: string; fromUserId: string },
    callback?: (data: { ok: boolean; error?: string; message?: string }) => void
  ) => {
    try {
      if (!isPrivileged) {
        callback?.({ ok: false, error: 'forbidden', message: 'Only dispatchers can accept calls' });
        return;
      }

      const access = await canAccessGroup(groupId);
      if (!access.ok) {
        callback?.({ ok: false, error: 'forbidden', message: 'Access denied' });
        return;
      }

      const payload = {
        callId,
        groupId,
        fromUserId,
        status: 'answered' as const,
        dispatcherId: userId,
        dispatcherCallsign: callsign,
        answeredAt: Date.now(),
      };

      io.to(`org:${organizationId}:dispatchers`).emit('dispatcher-call-status', payload);
      io.to(`user:${fromUserId}`).emit('dispatcher-call-status', payload);
      callback?.({ ok: true });
      logger.info({ msg: 'Dispatcher call accepted', callId, groupId, fromUserId, dispatcherId: userId });
    } catch (err) {
      logger.error({ msg: 'Ошибка dispatcher-call-accept', err, userId, groupId, callId });
      callback?.({ ok: false, error: 'server_error', message: 'Failed to accept dispatcher call' });
    }
  });

  // ─── Очистка при дисконнекте ──────────────────────────────
  socket.on('disconnect', async () => {
    clearInterval(pttRefreshTimer);
    // Освобождаем все PTT блокировки этого пользователя
    const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
    for (const groupId of rooms) {
      const released = await releasePttLock(groupId, userId);
      heldPttGroups.delete(groupId);
      if (released) {
        io.to(groupId).emit('channel-free', { groupId });
      }
    }
  });
}
