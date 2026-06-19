import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { prisma } from '../database/prisma';
import { authenticate, requireSuperAdmin, requireAdmin, requireDispatcher } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { UserRole, SensorKind, SensorAdapter, Prisma } from '@prisma/client';
import { emitOrgDataChanged } from '../utils/realtime';
import type { Server } from 'socket.io';

export const sensorsRouter = Router();

sensorsRouter.use(authenticate);

function param(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new AppError(400, `Invalid ${name}`);
  return value;
}

function generateSensorKey(): string {
  return randomBytes(24).toString('base64url');
}

// Правило порога (новый формат): метрика + условие + важность (+ дебаунс).
const ruleSchema = z.object({
  id: z.string().min(1).max(64),
  metric: z.string().min(1).max(64),
  op: z.enum(['gt', 'lt', 'outside', 'is']),
  value: z.union([z.number(), z.boolean()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  sustainedSec: z.number().int().nonnegative().optional(),
});

// Пороги: массив правил (новый) ИЛИ старый объект { metric: {min,max} } (back-compat).
const thresholdsSchema = z.union([
  z.array(ruleSchema),
  z.record(z.object({ min: z.number().optional(), max: z.number().optional() })),
]);

// POST — регистрация устройства (SUPERADMIN). PUSH или PULL.
const createSensorSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.nativeEnum(SensorKind),
  ingest: z.enum(['PULL', 'PUSH']).default('PULL'),
  adapter: z.nativeEnum(SensorAdapter).optional(), // только PULL
  sourceUrl: z.string().url().max(500).optional(), // только PULL
  externalId: z.string().max(64).optional(),
  organizationId: z.string().uuid().optional(),
  groupId: z.string().max(64).optional(),
  thresholds: thresholdsSchema.optional(),
  reportIntervalSec: z.number().int().positive().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  enabled: z.boolean().default(true),
  alarmSound: z.boolean().default(false),
});

// PATCH — настройка (ADMIN): правила, группа, вкл/выкл, имя, координаты, интервал.
const updateSensorSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  thresholds: thresholdsSchema.optional(),
  groupId: z.string().max(64).nullable().optional(),
  reportIntervalSec: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  alarmSound: z.boolean().optional(),
  // Reassign the sensor to another organization (SUPERADMIN only — enforced in handler).
  organizationId: z.string().uuid().optional(),
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

// POST /api/sensors — регистрация устройства (SUPERADMIN). PUSH → выдаём ключ.
sensorsRouter.post('/', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createSensorSchema.parse(req.body);
    const orgId = data.organizationId ?? req.user!.organizationId;

    if (data.groupId) await assertGroupInOrg(data.groupId, orgId);
    if (data.ingest === 'PULL' && (!data.adapter || !data.sourceUrl)) {
      throw new AppError(400, 'PULL sensor requires adapter and sourceUrl');
    }

    const sensor = await prisma.sensor.create({
      data: {
        organizationId: orgId,
        name: data.name,
        kind: data.kind,
        ingest: data.ingest,
        adapter: data.ingest === 'PULL' ? data.adapter ?? null : null,
        sourceUrl: data.ingest === 'PULL' ? data.sourceUrl ?? null : null,
        externalId: data.externalId ?? null,
        sensorKey: data.ingest === 'PUSH' ? generateSensorKey() : null,
        thresholds: (data.thresholds ?? []) as Prisma.InputJsonValue,
        reportIntervalSec: data.reportIntervalSec ?? null,
        groupId: data.groupId ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        enabled: data.enabled,
        alarmSound: data.alarmSound,
      },
    });

    emitOrgDataChanged(req, orgId, 'sensors', { sensorId: sensor.id, action: 'created' });
    res.status(201).json(sensor); // для PUSH включает sensorKey
  } catch (err) {
    next(err);
  }
});

// PATCH /api/sensors/:id — настройка (ADMIN)
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
    if (data.groupId !== undefined) updateData.groupId = data.groupId;
    if (data.reportIntervalSec !== undefined) updateData.reportIntervalSec = data.reportIntervalSec;
    if (data.alarmSound !== undefined) updateData.alarmSound = data.alarmSound;

    // Reassign to another organization — SUPERADMIN only. Groups are per-org, so
    // drop any stale group reference when moving the sensor across organizations.
    if (data.organizationId !== undefined && data.organizationId !== sensor.organizationId) {
      if (req.user!.role !== UserRole.SUPERADMIN) {
        throw new AppError(403, 'Only superadmin can reassign a sensor to another organization');
      }
      const org = await prisma.organization.findUnique({
        where: { id: data.organizationId },
        select: { id: true },
      });
      if (!org) throw new AppError(400, 'Organization not found');
      updateData.organizationId = data.organizationId;
      updateData.groupId = null;
    }

    const updated = await prisma.sensor.update({ where: { id }, data: updateData });

    emitOrgDataChanged(req, sensor.organizationId, 'sensors', { sensorId: id, action: 'updated' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/sensors/:id/arm — поставить/снять с охраны (DISPATCHER+)
// disarmed: телеметрия пишется, но алерты/инциденты/пуши подавляются (логика в processReading).
const armSchema = z.object({ armed: z.boolean() });
sensorsRouter.post('/:id/arm', requireDispatcher, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req.params.id, 'sensor id');
    const sensor = await prisma.sensor.findUnique({ where: { id } });
    if (!sensor) throw new AppError(404, 'Sensor not found');
    if (req.user!.role !== UserRole.SUPERADMIN && sensor.organizationId !== req.user!.organizationId) {
      throw new AppError(403, 'Access denied');
    }

    const { armed } = armSchema.parse(req.body);
    const updated = await prisma.sensor.update({ where: { id }, data: { armed } });

    // живое обновление панелей: armed + текущее состояние (метрики из lastValue, чтобы не обнулить)
    const lv = (updated.lastValue ?? {}) as Record<string, number | boolean>;
    const io = req.app.get('io') as Server | undefined;
    io?.to(`org:${sensor.organizationId}`).emit('sensor-update', {
      id: updated.id,
      name: updated.name,
      kind: updated.kind,
      status: updated.status,
      armed: updated.armed,
      metrics: lv,
      temperature: typeof lv.temperature === 'number' ? lv.temperature : null,
      humidity: typeof lv.humidity === 'number' ? lv.humidity : null,
      lat: updated.lat,
      lng: updated.lng,
      lastSeenAt: updated.lastSeenAt?.toISOString() ?? null,
    });
    res.json({ id, armed: updated.armed });
  } catch (err) {
    next(err);
  }
});

// POST /api/sensors/:id/rotate-key — новый ключ для push-датчика (SUPERADMIN)
sensorsRouter.post('/:id/rotate-key', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req.params.id, 'sensor id');
    const sensor = await prisma.sensor.findUnique({ where: { id } });
    if (!sensor) throw new AppError(404, 'Sensor not found');
    if (sensor.ingest !== 'PUSH') throw new AppError(400, 'Only push sensors have a key');

    const updated = await prisma.sensor.update({ where: { id }, data: { sensorKey: generateSensorKey() } });
    res.json({ sensorKey: updated.sensorKey });
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
