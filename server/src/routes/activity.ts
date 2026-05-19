import { Router, Request, Response, NextFunction } from 'express';
import { ActivityLogType, UserRole } from '@prisma/client';
import { prisma } from '../database/prisma';
import { authenticate, requireDispatcher } from '../middleware/auth';

export const activityRouter = Router();

activityRouter.use(authenticate);

activityRouter.get('/', requireDispatcher, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 300);
    const type = typeof req.query.type === 'string' && req.query.type in ActivityLogType
      ? (req.query.type as ActivityLogType)
      : undefined;

    const logs = await prisma.activityLog.findMany({
      where: {
        ...(req.user!.role === UserRole.SUPERADMIN ? {} : { organizationId: req.user!.organizationId }),
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        userId: true,
        callsign: true,
        displayName: true,
        createdAt: true,
        organization: { select: { name: true, slug: true } },
      },
    });

    res.json(logs);
  } catch (err) {
    next(err);
  }
});
