import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { authenticate } from '../middleware/auth';

export const devicesRouter = Router();

devicesRouter.use(authenticate);

/**
 * Токенов может быть два, и они разные.
 *
 * Android присылает только `pushToken` (FCM). iPhone — обычный токен APNs
 * и/или `voipToken` из PushKit, причём именно второй нужен, чтобы звонок
 * поднял спящий телефон. Приложение может зарегистрироваться, имея пока
 * только VoIP-токен: разрешение на баннеры человек мог и не дать, а звонок
 * работать обязан.
 */
const registerDeviceSchema = z
  .object({
    pushToken: z.string().min(20).max(4096).optional(),
    voipToken: z.string().min(20).max(4096).optional(),
    platform: z.enum(['ANDROID', 'IOS']),
    deviceName: z.string().trim().min(1).max(120).optional(),
    appVersion: z.string().trim().min(1).max(40).optional(),
  })
  .refine((v) => Boolean(v.pushToken || v.voipToken), {
    message: 'Either pushToken or voipToken is required',
  })
  .refine((v) => v.platform === 'IOS' || !v.voipToken, {
    message: 'voipToken is iOS-only',
  });

devicesRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = registerDeviceSchema.parse(req.body);
    const now = new Date();

    // Ищем по любому из присланных токенов: приложение может сначала отдать
    // VoIP-токен, а обычный — позже, когда человек разрешит уведомления.
    // Тогда это то же самое устройство, а не второе.
    const existing = await prisma.device.findFirst({
      where: {
        userId: req.user!.userId,
        OR: [
          ...(data.pushToken ? [{ pushToken: data.pushToken }] : []),
          ...(data.voipToken ? [{ voipToken: data.voipToken }] : []),
        ],
      },
      select: { id: true },
    });

    const fields = {
      userId: req.user!.userId,
      platform: data.platform,
      // undefined = не трогаем уже сохранённый токен другого типа.
      ...(data.pushToken ? { pushToken: data.pushToken } : {}),
      ...(data.voipToken ? { voipToken: data.voipToken } : {}),
      deviceName: data.deviceName,
      appVersion: data.appVersion,
      enabled: true,
      lastSeenAt: now,
    };

    const select = {
      id: true,
      platform: true,
      deviceName: true,
      appVersion: true,
      enabled: true,
      lastSeenAt: true,
    };

    const device = existing
      ? await prisma.device.update({ where: { id: existing.id }, data: fields, select })
      : await prisma.device.create({ data: fields, select });

    res.json(device);
  } catch (err) {
    next(err);
  }
});

devicesRouter.post('/unregister', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pushToken } = z.object({ pushToken: z.string().min(20).max(4096) }).parse(req.body);
    await prisma.device.updateMany({
      where: { pushToken, userId: req.user!.userId },
      data: { enabled: false },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
