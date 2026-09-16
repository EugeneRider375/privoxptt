import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../database/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { getDispatcherScope, PRIVILEGED_ROLES } from '../services/groupAccess';

export const sosRouter = Router();

sosRouter.use(authenticate);

const privilegedRoles = PRIVILEGED_ROLES;

const sosSelect = { id: true, userId: true, callsign: true, groupId: true, message: true, lat: true, lng: true, createdAt: true } as const;

function serializeSosAlerts(alerts: Array<{ id: string; userId: string; callsign: string; groupId: string | null; message: string; lat: number | null; lng: number | null; createdAt: Date }>) {
  return alerts.map((a) => ({
    id: a.id,
    userId: a.userId,
    callsign: a.callsign,
    groupId: a.groupId ?? undefined,
    message: a.message,
    lat: a.lat ?? undefined,
    lng: a.lng ?? undefined,
    timestamp: a.createdAt.getTime(),
  }));
}

/**
 * История SOS-тревог (D59) — холодное чтение того, что раньше существовало
 * только на время сокет-эмита. Без окна видимости по времени (в отличие от
 * D53 `arrivals`) и без проверки срока группы (D7) — тот же принцип, что и у
 * самой живой рассылки в `ptt.ts`: аварийный сигнал не должен прятаться по
 * календарным причинам. Retention не заведён (см. schema.prisma), поэтому
 * выдача сознательно ограничена последними записями через `take`.
 */
sosRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupIdParam = typeof req.query.groupId === 'string' ? req.query.groupId : undefined;

    if (privilegedRoles.includes(req.user!.role)) {
      const scope = await getDispatcherScope(req.user!.userId, req.user!.role);
      const alerts = await prisma.sosAlert.findMany({
        where: {
          organizationId: req.user!.organizationId,
          // scoped-диспетчер видит только SOS своих групп; без-групповые
          // сигналы (groupId: null) видны только неограниченному диспетчеру.
          ...(scope ? { groupId: { in: scope } } : {}),
          ...(groupIdParam ? { groupId: groupIdParam } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: sosSelect,
      });
      res.json(serializeSosAlerts(alerts));
      return;
    }

    if (!groupIdParam) {
      throw new AppError(400, 'groupId is required');
    }
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user!.userId, groupId: groupIdParam } },
    });
    if (!membership) {
      throw new AppError(403, 'Not a member of this group');
    }

    const alerts = await prisma.sosAlert.findMany({
      where: { groupId: groupIdParam },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: sosSelect,
    });
    res.json(serializeSosAlerts(alerts));
  } catch (err) {
    next(err);
  }
});
