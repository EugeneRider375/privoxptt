import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';
import { setupPresence } from './presence';
import { setupPtt } from './ptt';
import { setupMediasoupSocket } from '../mediasoup/router';
import { UserRole } from '@prisma/client';
import { getDispatcherScope } from '../services/groupAccess';

export interface SocketUserData {
  userId: string;
  callsign: string;
  displayName: string;
  organizationId: string;
  role: string;
}

export type AuthenticatedSocket = Socket & { data: SocketUserData };

export function setupSocketIO(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Ping/pong для детекции разрывов
    pingTimeout: 20000,
    pingInterval: 10000,
  });

  // ─── JWT middleware для Socket.io ─────────────────────────
  io.use(async (socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ||
      (socket.handshake.headers.authorization?.replace('Bearer ', '') ?? '');

    if (!token) {
      return next(new Error('Token was not provided'));
    }

    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as {
        userId: string;
        role: UserRole;
        organizationId: string;
      };

      // Проверяем что пользователь существует и активен
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          callsign: true,
          displayName: true,
          isActive: true,
          organizationId: true,
          role: true,
          accessExpiresAt: true,
        },
      });

      if (!user || !user.isActive) {
        return next(new Error('User not found or deactivated'));
      }

      // Срок доступа проверялся только при логине и refresh, а access-токен
      // живёт JWT_EXPIRES_IN (по умолчанию 7 дней) — то есть рация человека с
      // истёкшим сроком продолжала работать почти неделю. null = бессрочно,
      // так у всех, кто был до появления этой возможности.
      if (user.accessExpiresAt && user.accessExpiresAt < new Date()) {
        return next(new Error('Access period has expired'));
      }

      // Сохраняем данные пользователя в socket.data
      socket.data = {
        userId: user.id,
        callsign: user.callsign,
        displayName: user.displayName,
        organizationId: user.organizationId,
        role: user.role,
      } satisfies SocketUserData;

      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ─── Обработка подключений ────────────────────────────────
  io.on('connection', (socket) => {
    const s = socket as AuthenticatedSocket;
    const { userId, callsign, organizationId, role } = s.data;

    logger.info({ msg: 'Socket подключён', userId, callsign, socketId: socket.id });

    // Каждый пользователь входит в персональную комнату и комнату организации
    socket.join(`user:${userId}`);
    socket.join(`org:${organizationId}`);
    if (['SUPERADMIN', 'ADMIN', 'DISPATCHER'].includes(role)) {
      socket.join(`org:${organizationId}:dispatchers`);
      // D30 — scoped-диспетчер дополнительно вступает в комнаты своих групп,
      // чтобы user-location/dispatcher-call-request могли адресоваться точнее,
      // чем всей org:{id}:dispatchers разом. Не блокирует остальную настройку
      // сокета — новая строка в scope применяется со следующего подключения,
      // как и смена роли (не мгновенно, той же логике уже следует JWT).
      if (role === 'DISPATCHER') {
        getDispatcherScope(userId, role as UserRole)
          .then((scope) => {
            if (!scope) return;
            for (const groupId of scope) socket.join(`org:${organizationId}:dispatch-group:${groupId}`);
          })
          .catch((err) => logger.error({ msg: 'Не удалось получить scope диспетчера', err, userId }));
      }
    }

    setupPresence(io, s);
    setupPtt(io, s);
    setupMediasoupSocket(io, s);

    socket.on('disconnect', (reason) => {
      logger.info({ msg: 'Socket отключён', userId, callsign, reason });
    });

    socket.on('error', (err) => {
      logger.error({ msg: 'Socket ошибка', err, userId });
    });
  });

  return io;
}
