import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import {
  authenticate,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  refreshTokenExpiresAt,
  JwtPayload,
} from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

export const authRouter = Router();

// Поле называется email ради совместимости: так его шлют уже выпущенные
// клиенты, прошивки раций и мобильные сборки. Принимаем сюда и логин —
// различаем по символу "@", которого в логине быть не может по построению.
const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email or login is required'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email: identifier, password } = loginSchema.parse(req.body);

    const organization = { select: { id: true, name: true, slug: true } };
    const user = identifier.includes('@')
      ? await prisma.user.findUnique({
          where: { email: identifier },
          include: { organization },
        })
      : await prisma.user.findUnique({
          where: { login: identifier.toLowerCase() },
          include: { organization },
        });

    if (!user || !user.isActive) {
      throw new AppError(401, 'Invalid email or password');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      throw new AppError(401, 'Invalid email or password');
    }

    // Срок доступа. null = бессрочно, так у всех, кто был до этой возможности.
    if (user.accessExpiresAt && user.accessExpiresAt < new Date()) {
      throw new AppError(403, 'Access period has expired — contact your administrator');
    }

    const payload: JwtPayload = {
      userId: user.id,
      role: user.role,
      organizationId: user.organizationId,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Сохраняем refresh токен в БД — срок берём из самого токена
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: refreshTokenExpiresAt(refreshToken) },
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
        login: user.login,
        callsign: user.callsign,
        displayName: user.displayName,
        role: user.role,
        // Пароль выдан администратором как временный — клиент попросит сменить.
        mustChangePassword: user.mustChangePassword,
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

    // Без этой проверки истёкший доступ продлевался бы вечно: устройство
    // ротирует refresh при каждом запуске и второй раз через /login не идёт.
    if (storedToken.user.accessExpiresAt && storedToken.user.accessExpiresAt < new Date()) {
      throw new AppError(403, 'Access period has expired — contact your administrator');
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

    // Ротация токена — удаляем старый, создаём новый. Каждый запуск приложения
    // отодвигает срок ещё на год, поэтому устройство, которым пользуются,
    // повторного логина не потребует никогда.
    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { id: storedToken.id } }),
      prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: storedToken.userId,
          expiresAt: refreshTokenExpiresAt(newRefreshToken),
        },
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

    // lastSeen обновляется здесь, а фактический online/offline журнал ведет socket disconnect.
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { lastSeen: new Date() },
    });

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
        login: true,
        callsign: true,
        displayName: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        accessExpiresAt: true,
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
