import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { prisma } from '../database/prisma';
import { UserRole } from '@prisma/client';

export interface JwtPayload {
  userId: string;
  role: UserRole;
  organizationId: string;
}

// Расширяем Request чтобы хранить данные пользователя
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token is invalid or expired' });
  }
}

// Проверка роли — можно передать несколько допустимых ролей
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authorization required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

// Только суперадмин
export const requireSuperAdmin = requireRole(UserRole.SUPERADMIN);

// Суперадмин или администратор организации
export const requireAdmin = requireRole(UserRole.SUPERADMIN, UserRole.ADMIN);

// Диспетчер и выше
export const requireDispatcher = requireRole(
  UserRole.SUPERADMIN,
  UserRole.ADMIN,
  UserRole.DISPATCHER
);

// Проверяет что пользователь принадлежит той же организации что и ресурс
export async function sameOrganization(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }
  // Суперадмин видит все организации
  if (req.user.role === UserRole.SUPERADMIN) {
    next();
    return;
  }
  const orgId = req.params.orgId || req.body.organizationId;
  if (orgId && orgId !== req.user.organizationId) {
    res.status(403).json({ error: 'Access is limited to your organization' });
    return;
  }
  next();
}

// Генерация токенов
export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

/**
 * Каждый refresh-токен получает собственный идентификатор.
 *
 * Без него токен полностью определялся полезной нагрузкой и меткой времени в
 * СЕКУНДАХ: два выпуска подряд в пределах одной секунды давали одинаковую
 * строку, а в БД на неё уникальный индекс — второй выпуск падал с 409. Ловится
 * это редко, но закономерно: активация приглашения сначала в браузере, а сразу
 * следом в приложении, или двойное нажатие кнопки входа.
 */
export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign({ ...payload, jti: randomUUID() }, config.REFRESH_TOKEN_SECRET, {
    expiresIn: config.REFRESH_TOKEN_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, config.REFRESH_TOKEN_SECRET) as JwtPayload;
}

// Срок жизни строки RefreshToken в БД берём из самого токена, а не считаем
// отдельно: иначе подпись JWT и запись в БД разъезжаются (раньше в БД был
// захардкожен месяц, и правка REFRESH_TOKEN_EXPIRES_IN ничего не меняла —
// refresh всё равно отклонялся по expiresAt).
export function refreshTokenExpiresAt(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (decoded?.exp) {
    return new Date(decoded.exp * 1000);
  }
  // Токен только что выпущен нами, так что сюда попасть не должны; на всякий
  // случай не роняем логин, а даём консервативные 30 дней.
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 30);
  return fallback;
}
