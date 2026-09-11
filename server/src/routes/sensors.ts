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
  sensorKey: z.string().min(16).max(128).optional(), // PUSH: можно задать свой ключ; иначе сгенерится
  organizationId: z.string().uuid().optional(),
  // D37 — было groupId (одна группа, обязательно своя орг). Теперь список,
  // может включать группы ДРУГИХ организаций (см. assertGroupsForSensor).
  groupIds: z.array(z.string().max(64)).max(50).optional(),
  thresholds: thresholdsSchema.optional(),
  reportIntervalSec: z.number().int().positive().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  enabled: z.boolean().default(true),
  alarmSound: z.boolean().default(false),
});

// PATCH — настройка (ADMIN): правила, группы, вкл/выкл, имя, координаты, интервал.
const updateSensorSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  thresholds: thresholdsSchema.optional(),
  // undefined = не трогать группы; массив (в т.ч. пустой) = заменить набор целиком.
  groupIds: z.array(z.string().max(64)).max(50).optional(),
  reportIntervalSec: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  alarmSound: z.boolean().optional(),
  // Reassign the sensor to another organization (SUPERADMIN only — enforced in handler).
  organizationId: z.string().uuid().optional(),
  sensorKey: z.string().min(16).max(128).optional(), // сменить/вписать ключ push-датчика
});

/**
 * D37 — целевые группы датчика могут принадлежать ДРУГИМ организациям, но
 * привязывать чужую группу может только SUPERADMIN (решение Eugene,
 * 2026-09-11). Обычный ADMIN по-прежнему ограничен своей организацией —
 * ровно как раньше вело себя assertGroupInOrg, просто теперь для списка.
 */
async function assertGroupsForSensor(
  groupIds: string[],
  sensorOrgId: string,
  actingRole: UserRole,
): Promise<void> {
  if (groupIds.length === 0) return;
  const groups = await prisma.group.findMany({
    where: { id: { in: groupIds } },
    select: { id: true, organizationId: true },
  });
  if (groups.length !== new Set(groupIds).size) {
    throw new AppError(400, 'One or more groups not found');
  }
  if (actingRole !== UserRole.SUPERADMIN) {
    const foreign = groups.some((g) => g.organizationId !== sensorOrgId);
    if (foreign) {
      throw new AppError(403, 'Only superadmin can target a group from another organization');
    }
  }
}

/** Плоский вид groups[] для ответа клиенту — включая имя/организацию каждой цели. */
function serializeSensorGroups(
  groups: Array<{ group: { id: string; name: string; organizationId: string; organization: { name: string; slug: string } } }>,
) {
  return groups.map(({ group }) => ({
    id: group.id,
    name: group.name,
    organizationId: group.organizationId,
    organizationName: group.organization.name,
    organizationSlug: group.organization.slug,
  }));
}

const sensorGroupsInclude = {
  groups: {
    include: {
      group: {
        select: {
          id: true,
          name: true,
          organizationId: true,
          organization: { select: { name: true, slug: true } },
        },
      },
    },
  },
  organization: { select: { name: true, slug: true } },
} satisfies Prisma.SensorInclude;

type SensorWithGroups = Prisma.SensorGetPayload<{ include: typeof sensorGroupsInclude }>;

/**
 * Плоская форма ответа: groups[] вместо вложенной SensorGroup-обёртки, + isForeign.
 * SUPERADMIN не привязан ни к одной организации по правам — хозяйничает
 * везде, поэтому для него isForeign всегда false, независимо от того, какая
 * organizationId стоит у его собственной учётной записи (это чисто
 * формальное поле, на права SUPERADMIN не влияет нигде в проекте).
 */
function serializeSensor<T extends SensorWithGroups>(sensor: T, requesterOrgId: string, requesterRole: UserRole) {
  const { groups, ...rest } = sensor;
  return {
    ...rest,
    groups: serializeSensorGroups(groups),
    isForeign: requesterRole !== UserRole.SUPERADMIN && sensor.organizationId !== requesterOrgId,
  };
}

// GET /api/sensors — датчики своей организации + чужие датчики, нацеленные
// на группу своей организации (D37, только для чтения — см. isForeign в
// ответе). SUPERADMIN — все/по orgId, как раньше.
sensorsRouter.get('/', requireDispatcher, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role;
    const orgId = req.user!.organizationId;
    const requestedOrgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;

    const where: Prisma.SensorWhereInput =
      role === UserRole.SUPERADMIN
        ? (requestedOrgId ? { organizationId: requestedOrgId } : {})
        : { OR: [{ organizationId: orgId }, { groups: { some: { group: { organizationId: orgId } } } }] };

    const sensors = await prisma.sensor.findMany({
      where,
      include: sensorGroupsInclude,
      orderBy: { name: 'asc' },
    });

    res.json(sensors.map((s) => serializeSensor(s, orgId, role)));
  } catch (err) {
    next(err);
  }
});

// GET /api/sensors/:id — один датчик + последние замеры. Та же видимость,
// что и в списке (владелец ИЛИ организация-получатель одной из целевых групп).
sensorsRouter.get('/:id', requireDispatcher, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sensor = await prisma.sensor.findUnique({
      where: { id: param(req.params.id, 'sensor id') },
      include: { ...sensorGroupsInclude, readings: { take: 100, orderBy: { createdAt: 'desc' } } },
    });
    if (!sensor) throw new AppError(404, 'Sensor not found');

    const orgId = req.user!.organizationId;
    const isOwner = sensor.organizationId === orgId;
    const isTargetOrg = sensor.groups.some((g) => g.group.organizationId === orgId);
    if (req.user!.role !== UserRole.SUPERADMIN && !isOwner && !isTargetOrg) {
      throw new AppError(403, 'Access denied');
    }

    res.json(serializeSensor(sensor, orgId, req.user!.role));
  } catch (err) {
    next(err);
  }
});

// POST /api/sensors — регистрация устройства (SUPERADMIN). PUSH → выдаём ключ.
sensorsRouter.post('/', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createSensorSchema.parse(req.body);
    const orgId = data.organizationId ?? req.user!.organizationId;
    const groupIds = data.groupIds ?? [];

    await assertGroupsForSensor(groupIds, orgId, req.user!.role);
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
        sensorKey: data.ingest === 'PUSH' ? (data.sensorKey ?? generateSensorKey()) : null,
        thresholds: (data.thresholds ?? []) as Prisma.InputJsonValue,
        reportIntervalSec: data.reportIntervalSec ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        enabled: data.enabled,
        alarmSound: data.alarmSound,
        groups: { create: groupIds.map((groupId) => ({ groupId })) },
      },
      include: sensorGroupsInclude,
    });

    emitOrgDataChanged(req, orgId, 'sensors', { sensorId: sensor.id, action: 'created' });
    res.status(201).json(serializeSensor(sensor, req.user!.organizationId, req.user!.role)); // для PUSH включает sensorKey
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
    if (data.groupIds !== undefined) {
      await assertGroupsForSensor(data.groupIds, sensor.organizationId, req.user!.role);
    }

    const updateData: Prisma.SensorUncheckedUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.thresholds !== undefined) updateData.thresholds = data.thresholds as Prisma.InputJsonValue;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.lat !== undefined) updateData.lat = data.lat;
    if (data.lng !== undefined) updateData.lng = data.lng;
    if (data.reportIntervalSec !== undefined) updateData.reportIntervalSec = data.reportIntervalSec;
    if (data.alarmSound !== undefined) updateData.alarmSound = data.alarmSound;
    if (data.sensorKey !== undefined) updateData.sensorKey = data.sensorKey;

    // Reassign to another organization — SUPERADMIN only. Целевые группы были
    // проверены/выставлены в контексте СТАРОЙ организации, поэтому при смене
    // орга сбрасываем набор целиком — так было и раньше (одиночный groupId).
    let clearGroupsOnReassign = false;
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
      clearGroupsOnReassign = true;
    }

    const nextGroupIds = clearGroupsOnReassign ? [] : data.groupIds;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.sensor.update({ where: { id }, data: updateData });
      if (nextGroupIds !== undefined) {
        await tx.sensorGroup.deleteMany({ where: { sensorId: id } });
        if (nextGroupIds.length > 0) {
          await tx.sensorGroup.createMany({ data: nextGroupIds.map((groupId) => ({ sensorId: id, groupId })) });
        }
      }
      return tx.sensor.findUniqueOrThrow({ where: { id }, include: sensorGroupsInclude });
    });

    emitOrgDataChanged(req, sensor.organizationId, 'sensors', { sensorId: id, action: 'updated' });
    res.json(serializeSensor(updated, req.user!.organizationId, req.user!.role));
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
