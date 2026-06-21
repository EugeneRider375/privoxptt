// PUBLIC READ-ONLY API для комнатных дисплеев/индикаторов.
// Только ЧТЕНИЕ последних показаний датчиков. Авторизация — простым read-ключом
// (заголовок X-Read-Key === env PUBLIC_READ_KEY), без JWT. Ничего не меняет в БД.
// Аддитивно: отдельный роутер, не трогает существующие маршруты.
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../database/prisma';

export const publicRouter = Router();

// Проверка read-ключа. Если ключ в env не задан — фича выключена (503).
function requireReadKey(req: Request, res: Response, next: NextFunction) {
  const key = process.env.PUBLIC_READ_KEY;
  if (!key) return res.status(503).json({ error: 'Public read disabled' });
  if (req.header('x-read-key') !== key) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// GET /api/public/sensors — последние показания всех ВКЛЮЧЁННЫХ датчиков.
// Список и имена берутся из БД (админка Sensors) → дисплею ничего настраивать не нужно.
publicRouter.get('/sensors', requireReadKey, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = Date.now();
    const sensors = await prisma.sensor.findMany({
      where: { enabled: true },
      select: {
        id: true,
        name: true,
        kind: true,
        lastValue: true,    // { temperature, humidity, waterLevel, leak, motion, ... }
        batteryPct: true,
        rssi: true,
        lastSeenAt: true,
        status: true,       // OK | ALERT | STALE
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      ts: new Date().toISOString(),
      count: sensors.length,
      sensors: sensors.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        metrics: s.lastValue ?? {},
        battery: s.batteryPct,
        rssi: s.rssi,
        status: s.status,
        // секунд с последнего показания — дисплею не нужен NTP, просто покажет "X мин назад"
        ageSec: s.lastSeenAt ? Math.round((now - new Date(s.lastSeenAt).getTime()) / 1000) : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});
