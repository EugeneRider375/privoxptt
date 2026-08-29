import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../database/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '@prisma/client';
import { openGroupFilter } from '../services/groupAccess';

export const locationsRouter = Router();

locationsRouter.use(authenticate);

const privilegedRoles: UserRole[] = [UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.DISPATCHER];

/**
 * Последние известные позиции (D35) — подгружаются один раз при открытии
 * карты диспетчера. Без этого карта была пустой, пока сама вкладка не
 * успевала поймать чью-то живую точку по сокету (`user-location`) — теперь
 * это только досрочное обновление уже подгруженного.
 *
 * Право на чтение то же самое, что и на саму запись координат
 * (GroupMember.canShareLocation в открытой группе) — раскрывать позицию
 * тому, кому она перестала быть доступна, нельзя просто потому, что она
 * когда-то была сохранена.
 */
locationsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!privilegedRoles.includes(req.user!.role)) {
      throw new AppError(403, 'Only dispatchers and admins can view the map');
    }

    const users = await prisma.user.findMany({
      where: {
        organizationId: req.user!.organizationId,
        lastLat: { not: null },
        lastLng: { not: null },
        groupMembers: { some: { canShareLocation: true, group: openGroupFilter() } },
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
