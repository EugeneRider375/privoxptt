import { Router, raw, type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'socket.io';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { prisma } from '../database/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { sendIncomingMessagePush } from '../services/push';
import { logger } from '../utils/logger';

export const messagesRouter = Router();
messagesRouter.use(authenticate);

const uploadsDir = process.env.MESSAGE_UPLOAD_DIR ?? '/app/uploads/messages';
const maxAttachmentSize = 10 * 1024 * 1024;
const allowedAttachmentTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const attachmentTypesByExtension: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function attachmentType(headerValue: string, fileName: string) {
  const normalizedHeader = headerValue === 'image/jpg'
    ? 'image/jpeg'
    : headerValue === 'image/x-png'
      ? 'image/png'
      : headerValue;
  if (allowedAttachmentTypes.has(normalizedHeader)) return normalizedHeader;
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return attachmentTypesByExtension[extension];
}

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
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
  attachmentPath: string | null;
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
    attachment: message.attachmentPath ? {
      name: message.attachmentName ?? 'attachment',
      type: message.attachmentType ?? 'application/octet-stream',
      size: message.attachmentSize ?? 0,
    } : null,
    createdAt: message.createdAt.toISOString(),
    sender: message.sender,
    readCount: message._count.reads,
  };
}

async function resolveRecipients(
  target: z.infer<typeof targetSchema>,
  userId: string,
  organizationId: string,
  role: UserRole,
) {
  if (target.groupId) {
    const group = await assertGroupAccess(target.groupId, userId, organizationId, role);
    const recipients = await prisma.user.findMany({
      where: {
        organizationId,
        isActive: true,
        OR: [
          { groupMembers: { some: { groupId: target.groupId } } },
          { role: { in: privilegedRoles } },
        ],
      },
      select: { id: true },
    });
    return { recipientIds: recipients.map((recipient) => recipient.id), groupName: group.name };
  }
  const recipient = await assertDirectAccess(target.userId!, userId, organizationId, role);
  return { recipientIds: [userId, recipient.id], groupName: undefined };
}

async function publishMessage(
  req: Request,
  message: ReturnType<typeof serializeMessage>,
  recipientIds: string[],
  groupName?: string,
) {
  const io = req.app.get('io') as Server | undefined;
  for (const recipientId of new Set(recipientIds)) {
    io?.to(`user:${recipientId}`).emit('message:new', message);
  }
  const pushRecipientIds = [...new Set(recipientIds)].filter(
    (recipientId) => recipientId !== req.user!.userId,
  );
  await Promise.all(pushRecipientIds.map(async (recipientId) => {
    const unreadCount = await prisma.message.count({
      where: {
        organizationId: req.user!.organizationId,
        senderId: { not: recipientId },
        ...(message.groupId
          ? { groupId: message.groupId }
          : {
              OR: [
                { senderId: recipientId, recipientId: req.user!.userId },
                { senderId: req.user!.userId, recipientId },
              ],
            }),
        reads: { none: { userId: recipientId } },
      },
    });
    await sendIncomingMessagePush(recipientId, {
      messageId: message.id,
      senderId: message.senderId,
      senderCallsign: message.sender.callsign,
      senderDisplayName: message.sender.displayName,
      body: message.attachment?.name ?? message.body,
      groupId: message.groupId ?? undefined,
      groupName,
      unreadCount,
    });
  }));
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
    const { recipientIds, groupName } = await resolveRecipients(data, userId, organizationId, role);

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
    void publishMessage(req, payload, recipientIds, groupName).catch((err) => {
      logger.error({ msg: 'Unable to send message push notifications', messageId: created.id, err });
    });

    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

messagesRouter.post(
  '/attachments',
  raw({ type: () => true, limit: maxAttachmentSize }),
  async (req: Request, res: Response, next: NextFunction) => {
    let storedPath: string | null = null;
    try {
      const target = targetSchema.parse(req.query);
      const { userId, organizationId, role } = req.user!;
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new AppError(400, 'File is empty');
      }
      const encodedName = String(req.headers['x-file-name'] ?? '');
      const decodedName = decodeURIComponent(encodedName);
      const originalName = path.basename(decodedName.replaceAll('\\', '/')).slice(0, 180);
      if (!originalName) throw new AppError(400, 'File name is required');
      const contentType = attachmentType(
        String(req.headers['content-type'] ?? '').split(';')[0].toLowerCase(),
        originalName,
      );
      if (!contentType) {
        throw new AppError(415, 'This file type is not allowed');
      }

      const { recipientIds, groupName } = await resolveRecipients(
        target, userId, organizationId, role,
      );
      await mkdir(uploadsDir, { recursive: true });
      const fileId = randomUUID();
      storedPath = path.join(uploadsDir, fileId);
      await writeFile(storedPath, req.body);

      const created = await prisma.message.create({
        data: {
          organizationId,
          senderId: userId,
          recipientId: target.userId,
          groupId: target.groupId,
          body: '',
          attachmentName: originalName,
          attachmentType: contentType,
          attachmentSize: req.body.length,
          attachmentPath: storedPath,
          reads: { create: { userId } },
        },
        include: messageInclude,
      });
      const payload = serializeMessage(created);
      void publishMessage(req, payload, recipientIds, groupName).catch((err) => {
        logger.error({ msg: 'Unable to publish attachment message', messageId: created.id, err });
      });
      res.status(201).json(payload);
    } catch (err) {
      if (storedPath) await unlink(storedPath).catch(() => {});
      next(err);
    }
  },
);

messagesRouter.get('/:messageId/attachment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, organizationId, role } = req.user!;
    const message = await prisma.message.findFirst({
      where: { id: String(req.params.messageId), organizationId },
    });
    if (!message?.attachmentPath) throw new AppError(404, 'Attachment not found');
    if (message.groupId) {
      await assertGroupAccess(message.groupId, userId, organizationId, role);
    } else {
      const otherUserId = message.senderId === userId ? message.recipientId : message.senderId;
      if (!otherUserId) throw new AppError(403, 'Attachment access denied');
      await assertDirectAccess(otherUserId, userId, organizationId, role);
    }
    const content = await readFile(message.attachmentPath);
    res.setHeader('Content-Type', message.attachmentType ?? 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(message.attachmentName ?? 'attachment')}`,
    );
    res.send(content);
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

messagesRouter.post('/clear', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const target = targetSchema.parse(req.body);
    const { userId, organizationId, role } = req.user!;
    let recipientIds: string[];

    if (target.groupId) {
      await assertGroupAccess(target.groupId, userId, organizationId, role);
      if (!privilegedRoles.includes(role)) {
        throw new AppError(403, 'Only a dispatcher or administrator can clear group history');
      }
      const recipients = await prisma.user.findMany({
        where: {
          organizationId,
          isActive: true,
          OR: [
            { groupMembers: { some: { groupId: target.groupId } } },
            { role: { in: privilegedRoles } },
          ],
        },
        select: { id: true },
      });
      recipientIds = recipients.map((recipient) => recipient.id);
    } else {
      await assertDirectAccess(target.userId!, userId, organizationId, role);
      recipientIds = [userId, target.userId!];
    }

    const attachments = await prisma.message.findMany({
      where: { organizationId, ...conversationWhere(userId, target), attachmentPath: { not: null } },
      select: { attachmentPath: true },
    });
    const deleted = await prisma.message.deleteMany({
      where: {
        organizationId,
        ...conversationWhere(userId, target),
      },
    });
    await Promise.all(attachments.map(({ attachmentPath }) =>
      attachmentPath ? unlink(attachmentPath).catch(() => {}) : Promise.resolve()
    ));

    const io = req.app.get('io') as Server | undefined;
    for (const recipientId of new Set(recipientIds)) {
      const event = target.groupId
        ? { groupId: target.groupId, deletedCount: deleted.count }
        : {
            userId: recipientId === userId ? target.userId : userId,
            deletedCount: deleted.count,
          };
      io?.to(`user:${recipientId}`).emit('message:cleared', event);
    }

    logger.info({
      msg: 'Message history cleared',
      userId,
      organizationId,
      target,
      deletedCount: deleted.count,
    });
    res.json({ ok: true, deletedCount: deleted.count });
  } catch (err) {
    next(err);
  }
});
