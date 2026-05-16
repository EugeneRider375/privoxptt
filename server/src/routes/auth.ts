import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { redis } from '../database/redis';
import {
  authenticate,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  JwtPayload,
} from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, 'Invalid email or password');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      throw new AppError(401, 'Invalid email or password');
    }

    const payload: JwtPayload = {
      userId: user.id,
      role: user.role,
      organizationId: user.organizationId,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Сохраняем refresh токен в БД
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt },
    });

    // Обновляем lastSeen
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeen: new Date() },
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        callsign: user.callsign,
        displayName: user.displayName,
        role: user.role,
        organization: user.organization,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);

    // Проверяем токен в БД
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      throw new AppError(401, 'Refresh token is invalid or expired');
    }

    if (!storedToken.user.isActive) {
      throw new AppError(401, 'User is deactivated');
    }

    // Верифицируем подпись JWT
    verifyRefreshToken(refreshToken);

    const payload: JwtPayload = {
      userId: storedToken.user.id,
      role: storedToken.user.role,
      organizationId: storedToken.user.organizationId,
    };

    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    // Ротация токена — удаляем старый, создаём новый
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { id: storedToken.id } }),
      prisma.refreshToken.create({
        data: { token: newRefreshToken, userId: storedToken.userId, expiresAt },
      }),
    ]);

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };

    if (refreshToken) {
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken },
      });
    }

    // Помечаем пользователя оффлайн
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { lastSeen: new Date() },
    });

    // Удаляем онлайн статус из Redis
    await redis.del(`online:user:${req.user!.userId}`);

    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
authRouter.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        callsign: true,
        displayName: true,
        role: true,
        isActive: true,
        lastSeen: true,
        createdAt: true,
        organization: { select: { id: true, name: true, slug: true } },
        groupMembers: {
          select: {
            group: { select: { id: true, name: true, color: true, priority: true } },
            canSpeak: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
});
