import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '@prisma/client';
import { getPttLockOwner, isUserOnline } from '../database/redis';

export const groupsRouter = Router();

groupsRouter.use(authenticate);

const createGroupSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().default(false),
  priority: z.number().int().min(0).max(100).default(0),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Формат цвета: #RRGGBB')
    .default('#3DDC84'),
  organizationId: z.string().uuid().optional(),
});

const updateGroupSchema = createGroupSchema.partial();

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  canSpeak: z.boolean().default(true),
});

// GET /api/groups — мои группы
groupsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;

    // Суперадмин и диспетчер видят все группы организации
    const groups =
      [UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.DISPATCHER].includes(role)
        ? await prisma.group.findMany({
            where: role === UserRole.SUPERADMIN ? {} : { organizationId: orgId },
            include: {
              _count: { select: { members: true } },
              organization: { select: { name: true } },
            },
            orderBy: [{ priority: 'desc' }, { name: 'asc' }],
          })
        : await prisma.group.findMany({
            where: {
              organizationId: orgId,
              members: { some: { userId } },
            },
            include: {
              _count: { select: { members: true } },
              members: {
                where: { userId },
                select: { canSpeak: true },
              },
            },
            orderBy: [{ priority: 'desc' }, { name: 'asc' }],
          });

    // Добавляем текущего владельца PTT для каждой группы
    const groupsWithStatus = await Promise.all(
      groups.map(async (g) => ({
        ...g,
        pttOwnerId: await getPttLockOwner(g.id),
      }))
    );

    res.json(groupsWithStatus);
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/:id
groupsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({
      where: { id: req.params.id },
      include: {
        organization: { select: { id: true, name: true } },
        members: {
          include: {
            user: {
              select: {
                id: true, callsign: true, displayName: true, role: true,
              },
            },
          },
          orderBy: { user: { callsign: 'asc' } },
        },
      },
    });

    if (!group) throw new AppError(404, 'Группа не найдена');

    const isAdmin = [UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.DISPATCHER].includes(
      req.user!.role
    );
    const isMember = group.members.some((m) => m.userId === req.user!.userId);

    if (!isAdmin && !isMember) throw new AppError(403, 'Вы не состоите в этой группе');

    // Онлайн статусы участников
    const membersWithOnline = await Promise.all(
      group.members.map(async (m) => ({
        ...m,
        isOnline: await isUserOnline(m.userId),
      }))
    );

    res.json({
      ...group,
      members: membersWithOnline,
      pttOwnerId: await getPttLockOwner(group.id),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups
groupsRouter.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createGroupSchema.parse(req.body);
    const orgId =
      req.user!.role === UserRole.SUPERADMIN && data.organizationId
        ? data.organizationId
        : req.user!.organizationId;

    const group = await prisma.group.create({
      data: {
        name: data.name,
        description: data.description,
        isPrivate: data.isPrivate,
        priority: data.priority,
        color: data.color,
        organizationId: orgId,
      },
    });

    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
});

// PUT /api/groups/:id
groupsRouter.put('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) throw new AppError(404, 'Группа не найдена');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      group.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Доступ запрещён');
    }

    const data = updateGroupSchema.parse(req.body);
    const updated = await prisma.group.update({ where: { id }, data });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:id
groupsRouter.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) throw new AppError(404, 'Группа не найдена');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      group.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Доступ запрещён');
    }

    await prisma.group.delete({ where: { id } });
    res.json({ message: 'Группа удалена' });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups/:id/members — добавить участника
groupsRouter.post('/:id/members', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: groupId } = req.params;
    const { userId, canSpeak } = addMemberSchema.parse(req.body);

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new AppError(404, 'Группа не найдена');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, 'Пользователь не найден');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      group.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Доступ запрещён');
    }

    const member = await prisma.groupMember.create({
      data: { groupId, userId, canSpeak },
      include: {
        user: { select: { id: true, callsign: true, displayName: true } },
      },
    });

    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:id/members/:userId — удалить участника
groupsRouter.delete('/:id/members/:userId', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: groupId, userId } = req.params;

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new AppError(404, 'Группа не найдена');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      group.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Доступ запрещён');
    }

    await prisma.groupMember.deleteMany({ where: { groupId, userId } });
    res.json({ message: 'Участник удалён из группы' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/groups/:id/members/:userId — изменить права участника (canSpeak)
groupsRouter.patch('/:id/members/:userId', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: groupId, userId } = req.params;
    const { canSpeak } = z.object({ canSpeak: z.boolean() }).parse(req.body);

    const member = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
    });
    if (!member) throw new AppError(404, 'Участник не найден');

    const updated = await prisma.groupMember.update({
      where: { userId_groupId: { userId, groupId } },
      data: { canSpeak },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});
