import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '@prisma/client';
import { isUserOnline } from '../database/redis';

export const usersRouter = Router();

usersRouter.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Minimum 8 characters'),
  callsign: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[A-ZА-Я0-9-_ ]+$/i, 'Only letters, numbers, hyphen and space are allowed'),
  displayName: z.string().min(2).max(100),
  role: z.nativeEnum(UserRole).default(UserRole.USER),
  organizationId: z.string().uuid().optional(),
  canSpeak: z.boolean().default(true),
});

const updateUserSchema = z.object({
  callsign: z.string().min(2).max(20).optional(),
  displayName: z.string().min(2).max(100).optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
  deviceToken: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

function resolveOrgId(req: Request, bodyOrgId?: string): string {
  if (req.user!.role === UserRole.SUPERADMIN && bodyOrgId) return bodyOrgId;
  return req.user!.organizationId;
}

// GET /api/users — список пользователей своей организации
usersRouter.get('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.role === UserRole.SUPERADMIN
      ? (req.query.orgId as string | undefined) || undefined
      : req.user!.organizationId;

    const users = await prisma.user.findMany({
      where: orgId ? { organizationId: orgId } : {},
      select: {
        id: true, email: true, callsign: true, displayName: true,
        role: true, isActive: true, lastSeen: true, createdAt: true,
        organizationId: true,
        organization: { select: { name: true, slug: true } },
        _count: { select: { groupMembers: true } },
      },
      orderBy: { callsign: 'asc' },
    });

    // Добавляем онлайн статус из Redis
    const usersWithOnline = await Promise.all(
      users.map(async (u) => ({
        ...u,
        isOnline: await isUserOnline(u.id),
      }))
    );

    res.json(usersWithOnline);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/online — только онлайн пользователи
usersRouter.get('/online', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, isActive: true },
      select: { id: true, callsign: true, displayName: true, role: true },
    });

    const online = await Promise.all(
      users.map(async (u) => ({
        ...u,
        isOnline: await isUserOnline(u.id),
      }))
    );

    res.json(online.filter((u) => u.isOnline));
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id
usersRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, email: true, callsign: true, displayName: true,
        role: true, isActive: true, lastSeen: true, createdAt: true,
        organizationId: true,
        organization: { select: { name: true, slug: true } },
        groupMembers: {
          select: {
            canSpeak: true,
            group: { select: { id: true, name: true, color: true } },
          },
        },
      },
    });

    if (!user) throw new AppError(404, 'User not found');

    // Пользователь может смотреть только свой профиль или из своей организации
    if (
      req.user!.role === UserRole.USER &&
      user.id !== req.user!.userId
    ) {
      throw new AppError(403, 'Access denied');
    }

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      user.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Access denied');
    }

    res.json({ ...user, isOnline: await isUserOnline(user.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/users
usersRouter.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createUserSchema.parse(req.body);

    // Суперадмин может создавать в любой организации, остальные — только в своей
    if (data.role === UserRole.SUPERADMIN && req.user!.role !== UserRole.SUPERADMIN) {
      throw new AppError(403, 'Cannot create a superadmin');
    }

    const orgId = resolveOrgId(req, data.organizationId);
    const hash = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hash,
        callsign: data.callsign.toUpperCase(),
        displayName: data.displayName,
        role: data.role,
        organizationId: orgId,
      },
      select: {
        id: true, email: true, callsign: true, displayName: true,
        role: true, createdAt: true, organizationId: true,
      },
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id
usersRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Пользователь может менять только себя, админ — любого в своей организации
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError(404, 'User not found');

    const isOwnProfile = req.user!.userId === id;
    const isAdminOfOrg =
      [UserRole.SUPERADMIN, UserRole.ADMIN].includes(req.user!.role) &&
      (req.user!.role === UserRole.SUPERADMIN || target.organizationId === req.user!.organizationId);

    if (!isOwnProfile && !isAdminOfOrg) {
      throw new AppError(403, 'Access denied');
    }

    const data = updateUserSchema.parse(req.body);

    // Только админ может менять роль
    if (data.role && !isAdminOfOrg) {
      throw new AppError(403, 'Cannot change role');
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...data,
        callsign: data.callsign?.toUpperCase(),
      },
      select: {
        id: true, email: true, callsign: true, displayName: true,
        role: true, isActive: true,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/change-password
usersRouter.post('/:id/change-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (req.user!.userId !== id) {
      throw new AppError(403, 'You can only change your own password');
    }

    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError(404, 'User not found');

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) throw new AppError(401, 'Invalid current password');

    await prisma.user.update({
      where: { id },
      data: { password: await bcrypt.hash(newPassword, 12) },
    });

    res.json({ message: 'Password changed' });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/reset-password — только администратор
usersRouter.post('/:id/reset-password', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { newPassword } = resetPasswordSchema.parse(req.body);

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError(404, 'User not found');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      target.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Access denied');
    }

    await prisma.user.update({
      where: { id },
      data: { password: await bcrypt.hash(newPassword, 12) },
    });

    // Инвалидируем все refresh токены пользователя
    await prisma.refreshToken.deleteMany({ where: { userId: id } });

    res.json({ message: 'Password reset, all sessions ended' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id
usersRouter.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError(404, 'User not found');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      target.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Access denied');
    }

    await prisma.user.delete({ where: { id } });
    res.json({ message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});
