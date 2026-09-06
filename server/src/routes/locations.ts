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
