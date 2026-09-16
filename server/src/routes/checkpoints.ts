import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../database/prisma';
import { authenticate, requireDispatcher } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { getDispatcherScope } from '../services/groupAccess';
import { config } from '../config';
import { buildCheckpointUrl } from '../utils/credentials';

export const checkpointsRouter = Router();

checkpointsRouter.use(authenticate);

function param(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new AppError(400, `Invalid ${name}`);
  return value;
}

/**
 * D49.2 — "Guard Tour лайт": QR-код печатается один раз на контрольную точку
 * обхода (дверь, щит и т.п.), дальше сотрудник просто сканирует его обычной
 * камерой телефона во время обхода — без установки настоящего датчика на
 * каждой точке (идея из формы тестировщиков, Streltcoff, 2026-09-03).
 *
 * Управление точками (создание/список/удаление) — диспетчер и выше
 * (`requireDispatcher`), не только ADMIN: в отличие от датчиков/групп это
 * повседневная операционная задача, а не настройка системы (решение
 * Eugene, 2026-09-16, после первого живого теста). Скоуп по группе (D30) —
 * тот же принцип, что и у истории визитов: у диспетчера с ограниченным
 * scope список/создание/удаление видят только точки его групп.
 *
 * Сама отметка визита (`POST /:token/visit`) — любой аутентифицированный
 * сотрудник организации,
 * без проверки членства в конкретной группе: это разовое явное действие
 * самого человека о самом себе, тот же принцип, что и у чек-ина "Я прибыл"
 * (D53). Посторонний без аккаунта в системе до этого эндпоинта не дойдёт —
 * маршрут защищён `authenticate` так же, как и весь остальной роутер.
 */

async function assertGroupInOrg(groupId: string, organizationId: string): Promise<void> {
  const group = await prisma.group.findFirst({ where: { id: groupId, organizationId } });
  if (!group) throw new AppError(400, 'Group not found in this organization');
}

checkpointsRouter.get('/', requireDispatcher, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // D30 — тот же принцип скоупа, что и у истории визитов ниже.
    const scope = await getDispatcherScope(req.user!.userId, req.user!.role);
    const checkpoints = await prisma.checkpoint.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(scope ? { groupId: { in: scope } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { visits: true } } },
    });
    res.json(
      checkpoints.map((c) => ({
        id: c.id,
        name: c.name,
        groupId: c.groupId ?? undefined,
        token: c.token,
        visitUrl: buildCheckpointUrl(config.publicWebUrl, c.token),
        lat: c.lat ?? undefined,
        lng: c.lng ?? undefined,
        createdAt: c.createdAt.getTime(),
        visitCount: c._count.visits,
      })),
    );
  } catch (err) {
    next(err);
  }
});

checkpointsRouter.post('/', requireDispatcher, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, groupId, lat, lng } = req.body as { name?: string; groupId?: string; lat?: number; lng?: number };
    if (!name || !name.trim()) throw new AppError(400, 'name is required');
    if (groupId) await assertGroupInOrg(groupId, req.user!.organizationId);

    // Скоуп-диспетчер не может создать точку вне своих групп и не может
    // создать точку без группы вообще — она была бы невидима ему самому
    // сразу после создания (тот же критерий, что и в GET '/' /:id/visits).
    const scope = await getDispatcherScope(req.user!.userId, req.user!.role);
    if (scope) {
      if (!groupId || !scope.includes(groupId)) {
        throw new AppError(403, 'Choose a group within your dispatcher scope');
      }
    }

    const checkpoint = await prisma.checkpoint.create({
      data: {
        organizationId: req.user!.organizationId,
        groupId: groupId || null,
        name: name.trim(),
        lat: typeof lat === 'number' ? lat : null,
        lng: typeof lng === 'number' ? lng : null,
      },
    });
    res.status(201).json({
      id: checkpoint.id,
      name: checkpoint.name,
      groupId: checkpoint.groupId ?? undefined,
      token: checkpoint.token,
      visitUrl: buildCheckpointUrl(config.publicWebUrl, checkpoint.token),
      lat: checkpoint.lat ?? undefined,
      lng: checkpoint.lng ?? undefined,
      createdAt: checkpoint.createdAt.getTime(),
      visitCount: 0,
    });
  } catch (err) {
    next(err);
  }
});

checkpointsRouter.delete('/:id', requireDispatcher, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const checkpoint = await prisma.checkpoint.findFirst({
      where: { id: param(req.params.id, 'checkpoint id'), organizationId: req.user!.organizationId },
    });
    if (!checkpoint) throw new AppError(404, 'Checkpoint not found');

    const scope = await getDispatcherScope(req.user!.userId, req.user!.role);
    if (scope && (!checkpoint.groupId || !scope.includes(checkpoint.groupId))) {
      throw new AppError(403, 'Checkpoint outside your dispatcher scope');
    }

    await prisma.checkpoint.delete({ where: { id: checkpoint.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** История визитов одной точки — по образцу `GET /api/locations/arrivals` (D53). */
checkpointsRouter.get('/:id/visits', requireDispatcher, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const checkpoint = await prisma.checkpoint.findFirst({
      where: { id: param(req.params.id, 'checkpoint id'), organizationId: req.user!.organizationId },
    });
    if (!checkpoint) throw new AppError(404, 'Checkpoint not found');

    // D30 — scoped-диспетчер видит только точки своих групп; без-групповые
    // точки (groupId: null) видны только неограниченному диспетчеру/админу.
    const scope = await getDispatcherScope(req.user!.userId, req.user!.role);
    if (scope) {
      if (!checkpoint.groupId || !scope.includes(checkpoint.groupId)) {
        throw new AppError(403, 'Checkpoint outside your dispatcher scope');
      }
    }

    const visits = await prisma.checkpointVisit.findMany({
      where: { checkpointId: checkpoint.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, userId: true, callsign: true, lat: true, lng: true, createdAt: true },
    });
    res.json(
      visits.map((v) => ({
        id: v.id,
        userId: v.userId,
        callsign: v.callsign,
        lat: v.lat ?? undefined,
        lng: v.lng ?? undefined,
        timestamp: v.createdAt.getTime(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

/** Сама отметка скана — вызывается со страницы, на которую ведёт QR. */
checkpointsRouter.post('/:token/visit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lat, lng } = req.body as { lat?: number; lng?: number };
    const checkpoint = await prisma.checkpoint.findUnique({
      where: { token: param(req.params.token, 'checkpoint token') },
    });
    if (!checkpoint) throw new AppError(404, 'Checkpoint not found');
    if (checkpoint.organizationId !== req.user!.organizationId) {
      // Токен из чужой организации — не 404 (не путать с опечаткой в ссылке),
      // но и не раскрываем, что точка вообще существует у кого-то ещё.
      throw new AppError(403, 'This checkpoint belongs to a different organization');
    }

    // Позывного нет в JWT (см. JwtPayload) — достаём отдельно, как и на
    // сокет-стороне (там его в момент подключения читают из базы один раз).
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { callsign: true },
    });
    if (!user) throw new AppError(404, 'User not found');

    const visit = await prisma.checkpointVisit.create({
      data: {
        checkpointId: checkpoint.id,
        userId: req.user!.userId,
        organizationId: req.user!.organizationId,
        callsign: user.callsign,
        lat: typeof lat === 'number' ? lat : null,
        lng: typeof lng === 'number' ? lng : null,
      },
    });

    res.status(201).json({
      checkpointName: checkpoint.name,
      timestamp: visit.createdAt.getTime(),
    });
  } catch (err) {
    next(err);
  }
});
