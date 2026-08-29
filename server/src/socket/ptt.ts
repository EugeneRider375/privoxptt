import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import { prisma } from '../database/prisma';
import {
  acquirePttLock,
  releasePttLock,
  refreshPttLock,
  getPttLockOwner,
  isUserOnline,
  setUserCurrentGroup,
  clearUserCurrentGroup,
  getUserCurrentGroup,
  redis,
  PTT_LOCK_PREFIX,
} from '../database/redis';
import { logger } from '../utils/logger';
import { notifyDeviceCall } from '../udp-bridge';
import { hasReachablePushDevice, sendIncomingUserCallPush, sendMissedCallPush } from '../services/push';
import { createTrackedCall, respondToCallAsUser, endCall, isCallParticipant, type UserCallKind } from '../services/calls';
import { closeGroupPeers } from '../mediasoup/router';
import { checkGroupWindow, openGroupFilter, GROUP_WINDOW_SELECT } from '../services/groupAccess';
import type { AuthenticatedSocket } from './index';

const groupWakeCooldowns = new Map<string, number>();
const GROUP_WAKE_COOLDOWN_MS = 30_000;

export function setupPtt(io: Server, socket: AuthenticatedSocket): void {
  const { userId, callsign, displayName, organizationId, role } = socket.data;
  const heldPttGroups = new Set<string>();
  const isPrivileged = ['SUPERADMIN', 'ADMIN', 'DISPATCHER'].includes(role);

  const groupSelect = { id: true, name: true, organizationId: true, ...GROUP_WINDOW_SELECT };

  const canAccessGroup = async (groupId: string) => {
    const member = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: { select: groupSelect } },
    });

    if (member && member.group.organizationId === organizationId) {
      return { ok: true, group: member.group };
    }

    if (isPrivileged) {
      const group = await prisma.group.findFirst({
        where: role === 'SUPERADMIN' ? { id: groupId } : { id: groupId, organizationId },
        select: groupSelect,
      });
      if (group) return { ok: true, group };
    }

    return { ok: false, group: null };
  };

  /**
   * Доступ + открытое окно. Для всего, что НАЧИНАЕТ трафик: вход в группу,
   * PTT, звонок, вызов диспетчера. Срок группы действует на все роли, включая
   * SUPERADMIN, — просроченная группа это закрытый канал, а не канал с
   * исключениями (D7). Завершающие действия (ptt-stop, leave-group, ответ на
   * звонок, call-hangup) окно не проверяют: истечение срока посреди эфира не
   * должно оставлять висеть PTT-локи и комнаты mediasoup.
   */
  const canUseGroup = async (groupId: string) => {
    const access = await canAccessGroup(groupId);
    if (!access.ok || !access.group) {
      return { ok: false as const, group: null, reason: 'forbidden' as const, message: 'Access denied' };
    }

    const groupWindow = checkGroupWindow(access.group);
    if (!groupWindow.open) {
      logger.debug({ msg: 'Группа закрыта', userId, groupId, reason: groupWindow.reason });
      return { ok: false as const, group: access.group, reason: groupWindow.reason, message: groupWindow.message };
    }

    return { ok: true as const, group: access.group, reason: undefined, message: undefined };
  };

  /**
   * Право делиться координатами (GroupMember.canShareLocation).
   *
   * location-update прилетает с частотой GPS, поэтому право кешируем на
   * LOCATION_PERMISSION_TTL_MS: состав групп меняется несравнимо реже, чем
   * приходят точки, а поход в БД на каждую точку положил бы базу.
   *
   * Привязка к группе: пока человек на канале — судим по его правам именно в
   * этой группе. Когда он не в группе, координаты всё равно уходят диспетчерам
   * org-wide, поэтому разрешаем, только если хотя бы одно членство в открытой
   * группе это позволяет — иначе запрет обходился бы выходом из группы.
   */
  let locationPermission: { allowed: boolean; groupId: string | null; checkedAt: number } | null = null;
  const LOCATION_PERMISSION_TTL_MS = 30_000;

  const resolveLocationPermission = async (currentGroupId: string | null) => {
    // Диспетчеры и администраторы не ограничиваются членскими правами — так же,
    // как для canSpeak в ptt-start.
    if (isPrivileged) return true;

    if (currentGroupId) {
      const member = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId: currentGroupId } },
        select: { canShareLocation: true },
      });
      return member?.canShareLocation ?? false;
    }

    const permissive = await prisma.groupMember.findFirst({
      where: { userId, canShareLocation: true, group: openGroupFilter() },
      select: { id: true },
    });
    return permissive !== null;
  };

  const canShareLocationNow = async () => {
    const currentGroupId = await getUserCurrentGroup(userId);
    const cached = locationPermission;
    if (
      cached &&
      cached.groupId === currentGroupId &&
      Date.now() - cached.checkedAt < LOCATION_PERMISSION_TTL_MS
    ) {
      return cached.allowed;
    }

    const allowed = await resolveLocationPermission(currentGroupId);
    locationPermission = { allowed, groupId: currentGroupId, checkedAt: Date.now() };
    return allowed;
  };

  const deliverUserCall = async ({
    targetUserId,
    targetCallsign,
    groupId,
    groupName,
    kind,
    campaignId,
  }: {
    targetUserId: string;
    targetCallsign: string;
    groupId: string;
    groupName: string;
    kind: UserCallKind;
    campaignId?: string;
  }) => {
    const [targetOnline, hasPush] = await Promise.all([
      isUserOnline(targetUserId),
      hasReachablePushDevice(targetUserId),
    ]);
    const deviceDelivered = notifyDeviceCall(targetUserId, displayName || callsign, groupName);

    if (!targetOnline && !hasPush && !deviceDelivered) {
      return { delivered: false, socketOnline: false, pushSent: 0, deviceDelivered };
    }

    const call = createTrackedCall(io, {
      campaignId,
      kind,
      callerUserId: userId,
      callerCallsign: callsign,
      callerDisplayName: displayName,
      targetUserId,
      targetCallsign,
      groupId,
      groupName,
      onTimeout: (timedOutCall) => {
        sendMissedCallPush(targetUserId, {
          callId: timedOutCall.callId,
          fromUserId: userId,
          fromCallsign: callsign,
          fromDisplayName: displayName,
          groupId,
          groupName,
          kind,
        }).catch((err) => logger.error({ msg: 'Missed call push failed', err, targetUserId, callId: timedOutCall.callId }));
      },
    });

    io.to(`user:${targetUserId}`).emit('user-call-incoming', {
      callId: call.callId,
      campaignId: call.campaignId,
      kind,
      fromUserId: userId,
      fromCallsign: callsign,
      fromDisplayName: displayName,
      groupId,
      groupName,
      createdAt: call.createdAt,
    });

    const push = hasPush
      ? await sendIncomingUserCallPush(targetUserId, {
          callId: call.callId,
          fromUserId: userId,
          fromCallsign: callsign,
          fromDisplayName: displayName,
          groupId,
          groupName,
          createdAt: call.createdAt,
          responseToken: call.responseToken,
          kind,
        })
      : { sent: 0, failed: 0 };

    return {
      delivered: targetOnline || hasPush || deviceDelivered,
      callId: call.callId,
      campaignId: call.campaignId,
      socketOnline: targetOnline,
      pushSent: push.sent,
      deviceDelivered,
    };
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
      const access = await canUseGroup(groupId);
      if (!access.ok) {
        socket.emit('error', { code: access.reason.toUpperCase(), message: access.message });
        return;
      }

      socket.join(groupId);
      // Запоминаем текущую группу и сообщаем диспетчерам/орге
      await setUserCurrentGroup(userId, groupId);
      socket.to(`org:${organizationId}`).emit('user-group-changed', { userId, groupId });
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
    // Чистим текущую группу только если уходим именно из неё (не затираем уже начатый join другой)
    if ((await getUserCurrentGroup(userId)) === groupId) {
      await clearUserCurrentGroup(userId);
      socket.to(`org:${organizationId}`).emit('user-group-changed', { userId, groupId: null });
    }
    logger.debug({ msg: 'Покинул группу', userId, callsign, groupId });
  });

  // ─── PTT нажата ───────────────────────────────────────────
  socket.on('ptt-start', async (
    { groupId }: { groupId: string },
    callback?: (data: { ok: boolean; error?: string; message?: string }) => void
  ) => {
    try {
      const access = await canUseGroup(groupId);
      if (!access.ok) {
        callback?.({ ok: false, error: access.reason, message: access.message });
        socket.emit('channel-locked', {
          groupId,
          reason: access.reason,
          message: access.message,
        });
        return;
      }

      const member = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      });

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

  // ─── Визуальный вызов участника в группу ──────────────────
  socket.on('user-call-request', async (
    { targetUserId, groupId }: { targetUserId: string; groupId: string },
    callback?: (data: { ok: boolean; callId?: string; error?: string; message?: string }) => void
  ) => {
    try {
      if (targetUserId === userId) {
        callback?.({ ok: false, error: 'self_call', message: 'You cannot call yourself' });
        return;
      }

      const access = await canUseGroup(groupId);
      if (!access.ok || !access.group) {
        callback?.({ ok: false, error: access.reason, message: access.message });
        return;
      }

      const targetMember = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: targetUserId, groupId } },
        include: {
          user: {
            select: {
              id: true,
              callsign: true,
              displayName: true,
              isActive: true,
              organizationId: true,
            },
          },
        },
      });

      if (
        !targetMember ||
        !targetMember.user.isActive ||
        targetMember.user.organizationId !== access.group.organizationId
      ) {
        callback?.({ ok: false, error: 'not_member', message: 'User is not a member of this group' });
        return;
      }

      const delivery = await deliverUserCall({
        targetUserId,
        targetCallsign: targetMember.user.callsign,
        groupId,
        groupName: access.group.name,
        kind: 'user',
      });

      if (!delivery.delivered) {
        callback?.({ ok: false, error: 'offline', message: 'User is offline' });
        return;
      }

      logger.info({
        msg: 'User call requested',
        callId: delivery.callId,
        from: userId,
        to: targetUserId,
        groupId,
        socketOnline: delivery.socketOnline,
        pushSent: delivery.pushSent,
        deviceDelivered: delivery.deviceDelivered,
      });
      callback?.({ ok: true, callId: delivery.callId });
    } catch (err) {
      logger.error({ msg: 'Ошибка user-call-request', err, userId, targetUserId, groupId });
      callback?.({ ok: false, error: 'server_error', message: 'Failed to call user' });
    }
  });

  socket.on('group-call-request', async (
    { groupId }: { groupId: string },
    callback?: (data: {
      ok: boolean;
      campaignId?: string;
      total?: number;
      delivered?: number;
      unreachable?: number;
      error?: string;
      message?: string;
    }) => void
  ) => {
    try {
      // Будить группу может любой её участник, а не только диспетчер: на
      // рации это главная кнопка «позовите кого-нибудь», и человеку в поле
      // некогда искать, кто сегодня дежурит. Доступ ограничен членством —
      // canUseGroup пускает только своих, — а частота ограничена
      // задержкой в GROUP_WAKE_COOLDOWN_MS на каждого человека и группу.
      const access = await canUseGroup(groupId);
      if (!access.ok || !access.group) {
        callback?.({ ok: false, error: access.reason, message: access.message });
        return;
      }

      const cooldownKey = `${userId}:${groupId}`;
      const lastWake = groupWakeCooldowns.get(cooldownKey) ?? 0;
      const remainingMs = GROUP_WAKE_COOLDOWN_MS - (Date.now() - lastWake);
      if (remainingMs > 0) {
        callback?.({
          ok: false,
          error: 'cooldown',
          message: `Please wait ${Math.ceil(remainingMs / 1000)} seconds before waking this group again`,
        });
        return;
      }
      groupWakeCooldowns.set(cooldownKey, Date.now());

      const members = await prisma.groupMember.findMany({
        where: {
          groupId,
          userId: { not: userId },
          user: { isActive: true },
        },
        select: {
          userId: true,
          user: { select: { callsign: true } },
        },
      });

      const campaignId = randomUUID();
      const results = await Promise.all(members.map((member) =>
        deliverUserCall({
          targetUserId: member.userId,
          targetCallsign: member.user.callsign,
          groupId,
          groupName: access.group!.name,
          kind: 'group',
          campaignId,
        })
      ));
      const delivered = results.filter((result) => result.delivered).length;

      logger.info({
        msg: 'Group wake requested',
        campaignId,
        from: userId,
        groupId,
        total: members.length,
        delivered,
        unreachable: members.length - delivered,
      });
      callback?.({
        ok: true,
        campaignId,
        total: members.length,
        delivered,
        unreachable: members.length - delivered,
      });
    } catch (err) {
      logger.error({ msg: 'Group wake failed', err, userId, groupId });
      callback?.({ ok: false, error: 'server_error', message: 'Failed to wake group' });
    }
  });

  socket.on('user-call-response', (
    { callId, status }: { callId: string; status: 'answered' | 'declined' },
    callback?: (data: { ok: boolean; error?: string }) => void
  ) => {
    const accepted = respondToCallAsUser(io, callId, userId, status);
    callback?.(accepted ? { ok: true } : { ok: false, error: 'call_not_found_or_expired' });
  });

  // ─── Завершение дуплексного 1:1 звонка ────────────────────
  socket.on('call-hangup', (
    { callId }: { callId: string },
    callback?: (data: { ok: boolean }) => void
  ) => {
    endCall(io, callId, userId);
    closeGroupPeers(callId); // эфемерная комната, роутер/пиры больше не нужны
    callback?.({ ok: true });
  });

  // ─── Комната дуплекс-звонка (аудио через ту же MediaSoup-инфраструктуру,
  // callId передаётся как groupId — без PTT-лока, без канала группы;
  // useWebRTC() на клиенте не знает разницы между группой и звонком) ──────
  // Название поля — groupId, а не callId: useWebRTC() эмитит join-эвент с
  // тем же payload, что и для обычной группы, значение внутри — id звонка.
  socket.on('call-join', (
    { groupId: callId }: { groupId: string },
    callback?: (data: { ok: boolean; error?: string }) => void
  ) => {
    if (!isCallParticipant(callId, userId)) {
      callback?.({ ok: false, error: 'not_a_participant' });
      return;
    }
    socket.join(callId);
    callback?.({ ok: true });
  });

  socket.on('call-leave', ({ groupId: callId }: { groupId: string }) => {
    socket.leave(callId);
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
  socket.on('location-update', async (data: {
    lat: number; lng: number;
    heading?: number; speed?: number; timestamp: number;
  }) => {
    if (!(await canShareLocationNow())) return;

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

    // Последняя известная позиция (D35) — раньше координаты только
    // рассылались вживую и нигде не оседали, поэтому карта диспетчера была
    // пустой, пока никто не отправлял GPS именно в момент, когда вкладка с
    // картой была открыта. Ошибку записи не считаем поводом ронять сокет —
    // живая трансляция выше уже отработала.
    prisma.user.update({
      where: { id: userId },
      data: {
        lastLat: data.lat,
        lastLng: data.lng,
        lastHeading: data.heading,
        lastSpeed: data.speed,
        lastLocationAt: new Date(data.timestamp),
      },
    }).catch((err) => logger.error({ msg: 'Не удалось сохранить последнюю позицию', err, userId }));
  });

  // ─── SOS алерт ────────────────────────────────────────────
  // Намеренно без проверки срока группы (D7): это аварийный сигнал, он уходит
  // не только в группу, но и всей организации. Глушить крик о помощи из-за
  // календарной даты нельзя.
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
      const access = await canUseGroup(groupId);
      if (!access.ok || !access.group) {
        callback?.({ ok: false, error: access.reason, message: access.message });
        return;
      }

      const payload = {
        callId: randomUUID(),
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
      callback?.({ ok: true, callId: payload.callId });
      logger.info({ msg: 'Dispatcher call requested', userId, callsign, groupId, callId: payload.callId });
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

      // Намеренно canAccessGroup, а не canUseGroup: это ЗАВЕРШЕНИЕ уже
      // размещённого вызова. Вызов не мог быть создан в закрытой группе, а
      // истечение срока в секунду между запросом и ответом не повод бросить
      // человека без диспетчера.
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
