import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
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
    res.status(401).json({ error: 'Требуется авторизация' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Токен недействителен или истёк' });
  }
}

// Проверка роли — можно передать несколько допустимых ролей
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Требуется авторизация' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Недостаточно прав' });
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
    res.status(401).json({ error: 'Требуется авторизация' });
    return;
  }
  // Суперадмин видит все организации
  if (req.user.role === UserRole.SUPERADMIN) {
    next();
    return;
  }
  const orgId = req.params.orgId || req.body.organizationId;
  if (orgId && orgId !== req.user.organizationId) {
    res.status(403).json({ error: 'Доступ только к своей организации' });
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

export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.REFRESH_TOKEN_SECRET, {
    expiresIn: config.REFRESH_TOKEN_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, config.REFRESH_TOKEN_SECRET) as JwtPayload;
}
