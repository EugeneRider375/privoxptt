import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { authenticate } from '../middleware/auth';

export const devicesRouter = Router();

devicesRouter.use(authenticate);

const registerDeviceSchema = z.object({
  pushToken: z.string().min(20).max(4096),
  platform: z.enum(['ANDROID', 'IOS']),
  deviceName: z.string().trim().min(1).max(120).optional(),
  appVersion: z.string().trim().min(1).max(40).optional(),
});

devicesRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = registerDeviceSchema.parse(req.body);
    const now = new Date();

    const device = await prisma.device.upsert({
      where: { pushToken: data.pushToken },
      create: {
        userId: req.user!.userId,
        platform: data.platform,
        pushToken: data.pushToken,
        deviceName: data.deviceName,
        appVersion: data.appVersion,
        lastSeenAt: now,
      },
      update: {
        userId: req.user!.userId,
        platform: data.platform,
        deviceName: data.deviceName,
        appVersion: data.appVersion,
        enabled: true,
        lastSeenAt: now,
      },
      select: {
        id: true,
        platform: true,
        deviceName: true,
        appVersion: true,
        enabled: true,
        lastSeenAt: true,
      },
    });

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
