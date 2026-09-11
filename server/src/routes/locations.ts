import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../database/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { openGroupFilter, dispatcherGroupWhere, getDispatcherScope, PRIVILEGED_ROLES } from '../services/groupAccess';

export const locationsRouter = Router();

locationsRouter.use(authenticate);

const privilegedRoles = PRIVILEGED_ROLES;

/** Совсем старая позиция уже не «последняя известная», а вводящий в
 * заблуждение хлам — сутки нашли достаточным сроком (Eugene, 2026-08-29). */
const LOCATION_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Последние известные позиции (D35) — подгружаются один раз при открытии
 * карты диспетчера. Без этого карта была пустой, пока сама вкладка не
 * успевала поймать чью-то живую точку по сокету (`user-location`) — теперь
 * это только досрочное обновление уже подгруженного.
 *
 * Право на чтение то же самое, что и на саму запись координат
 * (GroupMember.canShareLocation в открытой группе) — раскрывать позицию
 * тому, кому она перестала быть доступна, нельзя просто потому, что она
 * когда-то была сохранена. Деактивированных (`isActive: false`) тоже не
 * показываем — иначе ушедший из команды человек висел бы на карте вечно.
 */
locationsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!privilegedRoles.includes(req.user!.role)) {
      throw new AppError(403, 'Only dispatchers and admins can view the map');
    }

    // D30 — scoped-диспетчер видит позиции только тех, кто состоит в группе
    // из его scope; scope===null (не ограничен) не меняет прежнего поведения.
    const scope = await getDispatcherScope(req.user!.userId, req.user!.role);

    const users = await prisma.user.findMany({
      where: {
        organizationId: req.user!.organizationId,
        isActive: true,
        lastLat: { not: null },
        lastLng: { not: null },
        lastLocationAt: { gte: new Date(Date.now() - LOCATION_STALE_MS) },
        groupMembers: {
          some: { canShareLocation: true, group: { ...openGroupFilter(), ...dispatcherGroupWhere(scope) } },
        },
      },
      select: {
        id: true,
        callsign: true,
        lastLat: true,
        lastLng: true,
        lastHeading: true,
        lastSpeed: true,
        lastLocationAt: true,
      },
    });

    res.json(
      users.map((u) => ({
        userId: u.id,
        callsign: u.callsign,
        lat: u.lastLat,
        lng: u.lastLng,
        heading: u.lastHeading ?? undefined,
        speed: u.lastSpeed ?? undefined,
        timestamp: u.lastLocationAt!.getTime(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

/** Сколько назад показывать чек-ины "Я прибыл" при холодной загрузке карты
 * (D53) — сама запись в базе живёт дольше (см. ARRIVAL_RETENTION_MS в
 * locationCleanup.ts), это только окно видимости на карте, тот же принцип,
 * что и у LOCATION_STALE_MS выше. */
const ARRIVAL_VISIBLE_MS = 24 * 60 * 60 * 1000;

/**
 * Недавние чек-ины "Я прибыл" (D53) — подгружаются один раз при открытии
 * карты, дальше живые обновления (`arrival-checkin`) освежают поверх.
 * Тот же принцип видимости и скоупинга, что у GET /api/locations.
 */
locationsRouter.get('/arrivals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!privilegedRoles.includes(req.user!.role)) {
      throw new AppError(403, 'Only dispatchers and admins can view arrivals');
    }

    const scope = await getDispatcherScope(req.user!.userId, req.user!.role);

    const checkIns = await prisma.arrivalCheckIn.findMany({
      where: {
        organizationId: req.user!.organizationId,
        createdAt: { gte: new Date(Date.now() - ARRIVAL_VISIBLE_MS) },
        // scoped-диспетчер видит только чек-ины своих групп; чек-ины без
        // группы (groupId: null) видны только неограниченному диспетчеру.
        ...(scope ? { groupId: { in: scope } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true, callsign: true, groupId: true, lat: true, lng: true, createdAt: true },
    });

    res.json(
      checkIns.map((c) => ({
        id: c.id,
        userId: c.userId,
        callsign: c.callsign,
        groupId: c.groupId ?? undefined,
        lat: c.lat,
        lng: c.lng,
        timestamp: c.createdAt.getTime(),
      })),
    );
  } catch (err) {
    next(err);
  }
});
