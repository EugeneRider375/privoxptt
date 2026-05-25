import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '@prisma/client';
import { getPttLockOwner, isUserOnline } from '../database/redis';
import { emitOrgDataChanged } from '../utils/realtime';

export const groupsRouter = Router();

groupsRouter.use(authenticate);

const privilegedRoles: UserRole[] = [UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.DISPATCHER];

function param(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new AppError(400, `Invalid ${name}`);
  return value;
}

const createGroupSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().default(false),
  priority: z.number().int().min(0).max(100).default(0),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color format: #RRGGBB')
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
    const requestedOrgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
    const role = req.user!.role;

    // Суперадмин и диспетчер видят все группы организации
    const groups =
      privilegedRoles.includes(role)
        ? await prisma.group.findMany({
            where: role === UserRole.SUPERADMIN
              ? (requestedOrgId ? { organizationId: requestedOrgId } : {})
              : { organizationId: orgId },
            include: {
              _count: { select: { members: true } },
              organization: { select: { name: true, slug: true } },
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
      where: { id: param(req.params.id, 'group id') },
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

    if (!group) throw new AppError(404, 'Group not found');

    const isAdmin =
      req.user!.role === UserRole.SUPERADMIN ||
      (privilegedRoles.includes(req.user!.role) && group.organization.id === req.user!.organizationId);
    const isMember = group.members.some((m) => m.userId === req.user!.userId);

    if (!isAdmin && !isMember) throw new AppError(403, 'You are not a member of this group');

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

    emitOrgDataChanged(req, orgId, 'groups', { groupId: group.id, action: 'created' });
    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
});

// PUT /api/groups/:id
groupsRouter.put('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req.params.id, 'group id');
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) throw new AppError(404, 'Group not found');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      group.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Access denied');
    }

    const data = updateGroupSchema.parse(req.body);
    const updated = await prisma.group.update({ where: { id }, data });
    emitOrgDataChanged(req, group.organizationId, 'groups', { groupId: id, action: 'updated' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:id
groupsRouter.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req.params.id, 'group id');
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) throw new AppError(404, 'Group not found');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      group.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Access denied');
    }

    await prisma.group.delete({ where: { id } });
    emitOrgDataChanged(req, group.organizationId, 'groups', { groupId: id, action: 'deleted' });
    res.json({ message: 'Group deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups/:id/members — добавить участника
groupsRouter.post('/:id/members', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = param(req.params.id, 'group id');
    const { userId, canSpeak } = addMemberSchema.parse(req.body);

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new AppError(404, 'Group not found');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, 'User not found');

    if (user.organizationId !== group.organizationId) {
      throw new AppError(400, 'User and group must belong to the same organization');
    }

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      group.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Access denied');
    }

    const member = await prisma.groupMember.create({
      data: { groupId, userId, canSpeak },
      include: {
        user: { select: { id: true, callsign: true, displayName: true } },
      },
    });

    emitOrgDataChanged(req, group.organizationId, 'members', { groupId, userId, action: 'member_added' });
    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:id/members/:userId — удалить участника
groupsRouter.delete('/:id/members/:userId', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = param(req.params.id, 'group id');
    const userId = param(req.params.userId, 'user id');

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new AppError(404, 'Group not found');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      group.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Access denied');
    }

    await prisma.groupMember.deleteMany({ where: { groupId, userId } });
    emitOrgDataChanged(req, group.organizationId, 'members', { groupId, userId, action: 'member_removed' });
    res.json({ message: 'Member removed from group' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/groups/:id/members/:userId — изменить права участника (canSpeak)
groupsRouter.patch('/:id/members/:userId', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = param(req.params.id, 'group id');
    const userId = param(req.params.userId, 'user id');
    const { canSpeak } = z.object({ canSpeak: z.boolean() }).parse(req.body);

    const member = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: { select: { organizationId: true } } },
    });
    if (!member) throw new AppError(404, 'Member not found');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      member.group.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Access denied');
    }

    const updated = await prisma.groupMember.update({
      where: { userId_groupId: { userId, groupId } },
      data: { canSpeak },
    });

    emitOrgDataChanged(req, member.group.organizationId, 'members', { groupId, userId, action: 'member_updated' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
