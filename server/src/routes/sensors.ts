import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { authenticate, requireSuperAdmin, requireAdmin, requireDispatcher } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { UserRole, SensorKind, SensorAdapter, Prisma } from '@prisma/client';
import { emitOrgDataChanged } from '../utils/realtime';

export const sensorsRouter = Router();

sensorsRouter.use(authenticate);

function param(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new AppError(400, `Invalid ${name}`);
  return value;
}

// Универсальные пороги: любая метрика (temperature, humidity, ...) → { min?, max? }
const thresholdsSchema = z.record(
  z.object({ min: z.number().optional(), max: z.number().optional() }),
);

// POST — регистрация устройства (только SUPERADMIN): источник/адаптер/тех-детали
const createSensorSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.nativeEnum(SensorKind),
  adapter: z.nativeEnum(SensorAdapter),
  sourceUrl: z.string().url().max(500),
  externalId: z.string().max(64).optional(),
  organizationId: z.string().uuid().optional(),
  groupId: z.string().max(64).optional(),
  thresholds: thresholdsSchema.default({}),
  lat: z.number().optional(),
  lng: z.number().optional(),
  enabled: z.boolean().default(true),
});

// PATCH — конфигурация (ADMIN): пороги, группа, вкл/выкл, имя, координаты.
// Тех-детали (adapter/sourceUrl/externalId/kind) тут не меняем — это регистрация (SUPERADMIN).
const updateSensorSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  thresholds: thresholdsSchema.optional(),
  groupId: z.string().max(64).nullable().optional(),
  enabled: z.boolean().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

async function assertGroupInOrg(groupId: string, organizationId: string): Promise<void> {
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { organizationId: true } });
  if (!group || group.organizationId !== organizationId) {
    throw new AppError(400, 'Group not found in this organization');
  }
}

// GET /api/sensors — список датчиков своей организации (SUPERADMIN — все/по orgId)
sensorsRouter.get('/', requireDispatcher, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role;
    const orgId = req.user!.organizationId;
    const requestedOrgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;

    const where: Prisma.SensorWhereInput =
      role === UserRole.SUPERADMIN
        ? (requestedOrgId ? { organizationId: requestedOrgId } : {})
        : { organizationId: orgId };

    const sensors = await prisma.sensor.findMany({
      where,
      include: {
        group: { select: { id: true, name: true } },
        organization: { select: { name: true, slug: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json(sensors);
  } catch (err) {
    next(err);
  }
});

// GET /api/sensors/:id — один датчик + последние замеры
sensorsRouter.get('/:id', requireDispatcher, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sensor = await prisma.sensor.findUnique({
      where: { id: param(req.params.id, 'sensor id') },
      include: {
        group: { select: { id: true, name: true } },
        readings: { take: 100, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!sensor) throw new AppError(404, 'Sensor not found');

    if (req.user!.role !== UserRole.SUPERADMIN && sensor.organizationId !== req.user!.organizationId) {
      throw new AppError(403, 'Access denied');
    }

    res.json(sensor);
  } catch (err) {
    next(err);
  }
});

// POST /api/sensors — регистрация нового устройства (SUPERADMIN)
sensorsRouter.post('/', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createSensorSchema.parse(req.body);
    const orgId = data.organizationId ?? req.user!.organizationId;

    if (data.groupId) await assertGroupInOrg(data.groupId, orgId);

    const sensor = await prisma.sensor.create({
      data: {
        organizationId: orgId,
        name: data.name,
        kind: data.kind,
        adapter: data.adapter,
        sourceUrl: data.sourceUrl,
        externalId: data.externalId ?? null,
        thresholds: data.thresholds as Prisma.InputJsonValue,
        groupId: data.groupId ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        enabled: data.enabled,
      },
    });

    emitOrgDataChanged(req, orgId, 'sensors', { sensorId: sensor.id, action: 'created' });
    res.status(201).json(sensor);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/sensors/:id — настройка (ADMIN): пороги, группа, вкл/выкл, имя, координаты
sensorsRouter.patch('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req.params.id, 'sensor id');
    const sensor = await prisma.sensor.findUnique({ where: { id } });
    if (!sensor) throw new AppError(404, 'Sensor not found');

    if (req.user!.role !== UserRole.SUPERADMIN && sensor.organizationId !== req.user!.organizationId) {
      throw new AppError(403, 'Access denied');
    }

    const data = updateSensorSchema.parse(req.body);
    if (data.groupId) await assertGroupInOrg(data.groupId, sensor.organizationId);

    const updateData: Prisma.SensorUncheckedUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.thresholds !== undefined) updateData.thresholds = data.thresholds as Prisma.InputJsonValue;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.lat !== undefined) updateData.lat = data.lat;
    if (data.lng !== undefined) updateData.lng = data.lng;
    if (data.groupId !== undefined) updateData.groupId = data.groupId; // null = отвязать

    const updated = await prisma.sensor.update({ where: { id }, data: updateData });

    emitOrgDataChanged(req, sensor.organizationId, 'sensors', { sensorId: id, action: 'updated' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sensors/:id — удалить устройство (SUPERADMIN)
sensorsRouter.delete('/:id', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req.params.id, 'sensor id');
    const sensor = await prisma.sensor.findUnique({ where: { id } });
    if (!sensor) throw new AppError(404, 'Sensor not found');

    await prisma.sensor.delete({ where: { id } });

    emitOrgDataChanged(req, sensor.organizationId, 'sensors', { sensorId: id, action: 'deleted' });
    res.json({ message: 'Sensor deleted' });
  } catch (err) {
    next(err);
  }
});
