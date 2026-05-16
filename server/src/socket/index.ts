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
        },
      });

      if (!user || !user.isActive) {
        return next(new Error('User not found or deactivated'));
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
    const { userId, callsign, organizationId } = s.data;

    logger.info({ msg: 'Socket подключён', userId, callsign, socketId: socket.id });

    // Каждый пользователь входит в персональную комнату и комнату организации
    socket.join(`user:${userId}`);
    socket.join(`org:${organizationId}`);

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
