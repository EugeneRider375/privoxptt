import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'socket.io';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { sendIncomingMessagePush } from '../services/push';
import { logger } from '../utils/logger';

export const messagesRouter = Router();
messagesRouter.use(authenticate);

const privilegedRoles: UserRole[] = [
  UserRole.SUPERADMIN,
  UserRole.ADMIN,
  UserRole.DISPATCHER,
];

const targetSchema = z.object({
  groupId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
}).refine((value) => Number(Boolean(value.groupId)) + Number(Boolean(value.userId)) === 1, {
  message: 'Exactly one conversation target is required',
});

const sendSchema = targetSchema.and(z.object({
  body: z.string().trim().min(1).max(4000),
}));

const historySchema = targetSchema.and(z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}));

const messageInclude = {
  sender: {
    select: {
      id: true,
      callsign: true,
      displayName: true,
      role: true,
    },
  },
  _count: { select: { reads: true } },
} as const;

function serializeMessage(message: {
  id: string;
  organizationId: string;
  senderId: string;
  recipientId: string | null;
  groupId: string | null;
  body: string;
  createdAt: Date;
  sender: {
    id: string;
    callsign: string;
    displayName: string;
    role: UserRole;
  };
  _count: { reads: number };
}) {
  return {
    id: message.id,
    organizationId: message.organizationId,
    senderId: message.senderId,
    recipientId: message.recipientId,
    groupId: message.groupId,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    sender: message.sender,
    readCount: message._count.reads,
  };
}

async function accessibleGroups(userId: string, organizationId: string, role: UserRole) {
  return prisma.group.findMany({
    where: privilegedRoles.includes(role)
      ? { organizationId }
      : { organizationId, members: { some: { userId } } },
    select: { id: true, name: true, color: true },
    orderBy: [{ priority: 'desc' }, { name: 'asc' }],
  });
}

async function assertGroupAccess(
  groupId: string,
  userId: string,
  organizationId: string,
  role: UserRole,
) {
  const group = await prisma.group.findFirst({
    where: privilegedRoles.includes(role)
      ? { id: groupId, organizationId }
      : { id: groupId, organizationId, members: { some: { userId } } },
    select: { id: true, name: true, color: true, organizationId: true },
  });
  if (!group) throw new AppError(403, 'You do not have access to this group chat');
  return group;
}

function directContactFilter(userId: string, organizationId: string, role: UserRole) {
  return privilegedRoles.includes(role)
    ? {
        groupMembers: {
          some: {
            group: { organizationId },
          },
        },
      }
    : {
        groupMembers: {
          some: {
            group: {
              members: { some: { userId } },
            },
          },
        },
      };
}

async function assertDirectAccess(
  targetUserId: string,
  userId: string,
  organizationId: string,
  role: UserRole,
) {
  if (targetUserId === userId) throw new AppError(400, 'You cannot message yourself');
  const target = await prisma.user.findFirst({
    where: {
      id: targetUserId,
      organizationId,
      isActive: true,
      ...directContactFilter(userId, organizationId, role),
    },
    select: { id: true, callsign: true, displayName: true, role: true },
  });
  if (!target) throw new AppError(403, 'Direct messages require access to a shared group');
  return target;
}

function conversationWhere(userId: string, target: z.infer<typeof targetSchema>) {
  if (target.groupId) return { groupId: target.groupId };
  return {
    OR: [
      { senderId: userId, recipientId: target.userId },
      { senderId: target.userId, recipientId: userId },
    ],
  };
}

messagesRouter.get('/conversations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, organizationId, role } = req.user!;
    const [groups, users] = await Promise.all([
      accessibleGroups(userId, organizationId, role),
      prisma.user.findMany({
        where: {
          organizationId,
          isActive: true,
          id: { not: userId },
          ...directContactFilter(userId, organizationId, role),
        },
        select: { id: true, callsign: true, displayName: true, role: true },
        orderBy: { callsign: 'asc' },
      }),
    ]);

    const groupConversations = await Promise.all(groups.map(async (group) => {
      const [last, unreadCount] = await Promise.all([
        prisma.message.findFirst({
          where: { groupId: group.id },
          include: messageInclude,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.message.count({
          where: {
            groupId: group.id,
            senderId: { not: userId },
            reads: { none: { userId } },
          },
        }),
      ]);
      return {
        type: 'group' as const,
        id: group.id,
        title: group.name,
        color: group.color,
        unreadCount,
        lastMessage: last ? serializeMessage(last) : null,
      };
    }));

    const directConversations = await Promise.all(users.map(async (target) => {
      const directWhere = conversationWhere(userId, { userId: target.id });
      const [last, unreadCount] = await Promise.all([
        prisma.message.findFirst({
          where: directWhere,
          include: messageInclude,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.message.count({
          where: {
            senderId: target.id,
            recipientId: userId,
            reads: { none: { userId } },
          },
        }),
      ]);
      return {
        type: 'direct' as const,
        id: target.id,
        title: target.callsign,
        subtitle: target.displayName,
        role: target.role,
        unreadCount,
        lastMessage: last ? serializeMessage(last) : null,
      };
    }));

    res.json([...groupConversations, ...directConversations]);
  } catch (err) {
    next(err);
  }
});

messagesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const target = historySchema.parse(req.query);
    const { userId, organizationId, role } = req.user!;
    if (target.groupId) {
      await assertGroupAccess(target.groupId, userId, organizationId, role);
    } else {
      await assertDirectAccess(target.userId!, userId, organizationId, role);
    }

    const messages = await prisma.message.findMany({
      where: {
        organizationId,
        ...conversationWhere(userId, target),
      },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: target.limit + 1,
      ...(target.cursor ? { cursor: { id: target.cursor }, skip: 1 } : {}),
    });
    const hasMore = messages.length > target.limit;
    const page = hasMore ? messages.slice(0, target.limit) : messages;
    const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;
    res.json({
      messages: page.reverse().map(serializeMessage),
      nextCursor,
    });
  } catch (err) {
    next(err);
  }
});

messagesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = sendSchema.parse(req.body);
    const { userId, organizationId, role } = req.user!;
    let recipientIds: string[];
    let groupName: string | undefined;

    if (data.groupId) {
      const group = await assertGroupAccess(data.groupId, userId, organizationId, role);
      groupName = group.name;
      const recipients = await prisma.user.findMany({
        where: {
          organizationId,
          isActive: true,
          OR: [
            { groupMembers: { some: { groupId: data.groupId } } },
            { role: { in: privilegedRoles } },
          ],
        },
        select: { id: true },
      });
      recipientIds = recipients.map((recipient) => recipient.id);
    } else {
      const recipient = await assertDirectAccess(data.userId!, userId, organizationId, role);
      recipientIds = [userId, recipient.id];
    }

    const created = await prisma.message.create({
      data: {
        organizationId,
        senderId: userId,
        recipientId: data.userId,
        groupId: data.groupId,
        body: data.body,
        reads: { create: { userId } },
      },
      include: messageInclude,
    });
    const payload = serializeMessage(created);
    const io = req.app.get('io') as Server | undefined;
    for (const recipientId of new Set(recipientIds)) {
      io?.to(`user:${recipientId}`).emit('message:new', payload);
    }

    const pushRecipientIds = [...new Set(recipientIds)].filter((recipientId) => recipientId !== userId);
    void Promise.all(pushRecipientIds.map(async (recipientId) => {
      const unreadCount = await prisma.message.count({
        where: {
          organizationId,
          senderId: { not: recipientId },
          ...(data.groupId
            ? { groupId: data.groupId }
            : {
                OR: [
                  { senderId: recipientId, recipientId: userId },
                  { senderId: userId, recipientId },
                ],
              }),
          reads: { none: { userId: recipientId } },
        },
      });
      await sendIncomingMessagePush(recipientId, {
        messageId: created.id,
        senderId: created.senderId,
        senderCallsign: created.sender.callsign,
        senderDisplayName: created.sender.displayName,
        body: created.body,
        groupId: created.groupId ?? undefined,
        groupName,
        unreadCount,
      });
    })).catch((err) => {
      logger.error({ msg: 'Unable to send message push notifications', messageId: created.id, err });
    });

    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

messagesRouter.post('/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const target = targetSchema.parse(req.body);
    const { userId, organizationId, role } = req.user!;
    if (target.groupId) {
      await assertGroupAccess(target.groupId, userId, organizationId, role);
    } else {
      await assertDirectAccess(target.userId!, userId, organizationId, role);
    }

    const unread = await prisma.message.findMany({
      where: {
        organizationId,
        senderId: { not: userId },
        ...conversationWhere(userId, target),
        reads: { none: { userId } },
      },
      select: { id: true },
    });
    if (unread.length > 0) {
      await prisma.messageRead.createMany({
        data: unread.map((message) => ({ messageId: message.id, userId })),
        skipDuplicates: true,
      });
    }
    res.json({ ok: true, readCount: unread.length });
  } catch (err) {
    next(err);
  }
});
