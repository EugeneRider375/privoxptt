// Обработка одного замера датчика (общая для поллера и /api/telemetry):
// метрики → проверка правил (с дебаунсом) → инциденты (open/resolve) → emit + push.

import type { Server } from 'socket.io';
import type { Sensor } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { logger } from '../../utils/logger';
import { thresholdsToRules, evaluateRules, type MetricValue } from './adapters';
import { sendSensorAlertPushToUsers } from '../push';

const DEFAULT_STALE_MS = 20 * 60_000; // молчание дольше → STALE (если не задан reportIntervalSec)
const STALE_RULE_ID = '__stale__';

// Дебаунс: ключ `${sensorId}:${ruleId}` → когда правило начало срабатывать (ms).
const pendingSince = new Map<string, number>();

type Metrics = Record<string, MetricValue>;

function num(v: MetricValue | undefined): number | null {
  return typeof v === 'number' ? v : null;
}

export interface ProcessOpts {
  // observedAt — время замера (для poll берётся из источника, для push = сейчас)
  observedAt: Date | null;
  // raw — сырой ответ источника (для poll), опц.
  raw?: unknown;
}

export async function processReading(
  io: Server,
  sensor: Sensor,
  metrics: Metrics,
  opts: ProcessOpts,
): Promise<void> {
  const now = new Date();
  const observedAt = opts.observedAt;

  const staleMs = sensor.reportIntervalSec ? sensor.reportIntervalSec * 1000 * 2 : DEFAULT_STALE_MS;
  const stale = !observedAt || now.getTime() - observedAt.getTime() > staleMs;

  const rules = thresholdsToRules(sensor.thresholds);
  const fired = stale ? [] : evaluateRules(metrics, rules);

  // ── Дебаунс sustainedSec: правило «активно», если держится достаточно долго ──
  const firedIds = new Set(fired.map((f) => f.ruleId));
  for (const key of [...pendingSince.keys()]) {
    if (key.startsWith(sensor.id + ':')) {
      const rid = key.slice(sensor.id.length + 1);
      if (!firedIds.has(rid)) pendingSince.delete(key);
    }
  }
  const active = fired.filter((f) => {
    const rule = rules.find((r) => r.id === f.ruleId);
    const need = rule?.sustainedSec ?? 0;
    if (need <= 0) return true;
    const key = `${sensor.id}:${f.ruleId}`;
    const since = pendingSince.get(key);
    if (since === undefined) { pendingSince.set(key, now.getTime()); return false; }
    return now.getTime() - since >= need * 1000;
  });

  const newStatus: Sensor['status'] = stale ? 'STALE' : active.length > 0 ? 'ALERT' : 'OK';

  // ── История (только если есть метрики) ──
  if (Object.keys(metrics).length > 0) {
    await prisma.sensorReading.create({
      data: {
        sensorId: sensor.id,
        metrics: metrics as object,
        temperature: num(metrics.temperature),
        humidity: num(metrics.humidity),
        raw: (opts.raw ?? null) as object,
      },
    });
  }

  // ── Обновление датчика (+ здоровье из метрик) ──
  const battery = num(metrics.battery);
  const rssi = num(metrics.rssi);
  await prisma.sensor.update({
    where: { id: sensor.id },
    data: {
      lastValue: metrics as object,
      lastSeenAt: observedAt ?? sensor.lastSeenAt,
      status: newStatus,
      ...(battery !== null ? { batteryPct: battery } : {}),
      ...(rssi !== null ? { rssi } : {}),
    },
  });

  // ── Живое обновление дашборда (всегда) ──
  io.to(`org:${sensor.organizationId}`).emit('sensor-update', {
    id: sensor.id,
    name: sensor.name,
    kind: sensor.kind,
    status: newStatus,
    metrics,
    temperature: num(metrics.temperature),
    humidity: num(metrics.humidity),
    lat: sensor.lat,
    lng: sensor.lng,
    lastSeenAt: (observedAt ?? sensor.lastSeenAt)?.toISOString() ?? null,
  });

  // ── Инциденты: что сейчас активно ──
  const activeNow = new Map<string, { severity: 'INFO' | 'WARNING' | 'CRITICAL'; message: string; metric: string | null; value: number | null }>();
  for (const f of active) {
    activeNow.set(f.ruleId, { severity: f.severity, message: f.message, metric: f.metric, value: num(f.value) });
  }
  if (stale) {
    activeNow.set(STALE_RULE_ID, { severity: 'WARNING', message: 'Нет данных от датчика', metric: null, value: null });
  }

  const openIncidents = await prisma.incident.findMany({
    where: { sensorId: sensor.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
  });
  const openByRule = new Set(openIncidents.map((i) => i.ruleId ?? ''));

  // открыть новые
  for (const [ruleId, info] of activeNow) {
    if (openByRule.has(ruleId)) continue;
    await prisma.incident.create({
      data: {
        sensorId: sensor.id,
        ruleId,
        metric: info.metric,
        severity: info.severity,
        status: 'OPEN',
        message: info.message,
        peakValue: info.value,
        lastNotifiedAt: now,
      },
    });
    logger.warn({ msg: '🔴 INCIDENT OPEN', sensor: sensor.name, severity: info.severity, message: info.message });
    await notify(io, sensor, newStatus, info.message, metrics, now);
  }

  // закрыть решённые
  for (const inc of openIncidents) {
    if (!activeNow.has(inc.ruleId ?? '')) {
      await prisma.incident.update({ where: { id: inc.id }, data: { status: 'RESOLVED', resolvedAt: now } });
      logger.info({ msg: '✅ INCIDENT RESOLVED', sensor: sensor.name, ruleId: inc.ruleId });
    }
  }
}

async function notify(
  io: Server,
  sensor: Sensor,
  status: Sensor['status'],
  message: string,
  metrics: Metrics,
  now: Date,
): Promise<void> {
  const payload = {
    sensorId: sensor.id,
    name: sensor.name,
    kind: sensor.kind,
    status,
    message,
    metrics,
    temperature: num(metrics.temperature),
    humidity: num(metrics.humidity),
    groupId: sensor.groupId,
    lat: sensor.lat,
    lng: sensor.lng,
    at: now.toISOString(),
  };
  io.to(`org:${sensor.organizationId}`).emit('sensor-alert', payload);
  if (sensor.groupId) io.to(sensor.groupId).emit('sensor-alert', payload);

  if (sensor.groupId) {
    const members = await prisma.groupMember.findMany({
      where: { groupId: sensor.groupId },
      select: { userId: true },
    });
    const userIds = members.map((m) => m.userId);
    if (userIds.length > 0) {
      void sendSensorAlertPushToUsers(userIds, {
        sensorId: sensor.id,
        sensorName: sensor.name,
        status: status === 'STALE' ? 'STALE' : 'ALERT',
        message,
      }).catch((err) => logger.warn({ msg: 'sensor push failed', sensorId: sensor.id, err }));
    }
  }
}
