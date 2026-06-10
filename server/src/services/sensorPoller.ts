// Поллер внешних датчиков.
// Периодически опрашивает публичные API датчиков (Frigo, HomeClimate),
// нормализует значения, проверяет пороги и при ПЕРЕХОДЕ в тревогу
// (edge-trigger) шлёт sensor-alert в Socket.IO + push в группу.
//
// Запускается graceful'но (как startUdpBridge): если поллер падает —
// основной PTT/WebRTC-сервер продолжает работать.

import type { Server } from 'socket.io';
import type { Sensor } from '@prisma/client';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';
import {
  normalizeFrigo,
  normalizeHomeclimate,
  evaluateThresholds,
  type NormalizedReading,
  type Thresholds,
} from './sensors/adapters';
import { sendSensorAlertPushToUsers } from './push';

const POLL_INTERVAL_MS = 15_000; // как часто опрашиваем датчики
const STALE_MINUTES = 20; // молчание дольше → статус «нет данных»
const FETCH_TIMEOUT_MS = 8_000;

let timer: NodeJS.Timeout | null = null;

export function startSensorPoller(io: Server): void {
  if (timer) return;
  logger.info({ msg: '🌡️  Sensor poller запущен', intervalMs: POLL_INTERVAL_MS });
  // первый прогон сразу, затем по интервалу
  void pollOnce(io);
  timer = setInterval(() => void pollOnce(io), POLL_INTERVAL_MS);
}

export function stopSensorPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Один полный цикл опроса всех включённых датчиков. Экспортирован для тестов.
export async function pollOnce(io: Server): Promise<void> {
  let sensors: Sensor[];
  try {
    // Поллим только PULL-датчики с URL. PUSH-устройства шлют сами на /api/telemetry.
    sensors = await prisma.sensor.findMany({
      where: { enabled: true, ingest: 'PULL', sourceUrl: { not: null } },
    });
  } catch (err) {
    logger.warn({ msg: 'sensor poller: не удалось прочитать датчики', err });
    return;
  }
  for (const sensor of sensors) {
    try {
      await pollSensor(io, sensor);
    } catch (err) {
      logger.warn({ msg: 'sensor poll failed', sensorId: sensor.id, name: sensor.name, err });
    }
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function normalize(sensor: Sensor, json: unknown): NormalizedReading {
  if (sensor.adapter === 'FRIGO') return normalizeFrigo(json);
  return normalizeHomeclimate(json, sensor.externalId);
}

async function pollSensor(io: Server, sensor: Sensor): Promise<void> {
  if (!sensor.sourceUrl) return; // PUSH-датчики не поллим
  const json = await fetchJson(sensor.sourceUrl);
  const reading = normalize(sensor, json);

  const now = new Date();
  const stale =
    !reading.observedAt || now.getTime() - reading.observedAt.getTime() > STALE_MINUTES * 60_000;

  const thresholds = (sensor.thresholds ?? {}) as Thresholds;
  const reasons = stale ? [] : evaluateThresholds(reading, thresholds);
  const newStatus: Sensor['status'] = stale ? 'STALE' : reasons.length > 0 ? 'ALERT' : 'OK';
  const prevStatus = sensor.status;

  // история — только если реально получили значение
  if (reading.temperature != null || reading.humidity != null) {
    await prisma.sensorReading.create({
      data: {
        sensorId: sensor.id,
        temperature: reading.temperature,
        humidity: reading.humidity,
        raw: json as object,
      },
    });
  }

  await prisma.sensor.update({
    where: { id: sensor.id },
    data: {
      lastValue: { temperature: reading.temperature, humidity: reading.humidity },
      lastSeenAt: reading.observedAt ?? sensor.lastSeenAt,
      status: newStatus,
    },
  });

  // живое обновление дашборда — ВСЕГДА
  io.to(`org:${sensor.organizationId}`).emit('sensor-update', {
    id: sensor.id,
    name: sensor.name,
    kind: sensor.kind,
    status: newStatus,
    temperature: reading.temperature,
    humidity: reading.humidity,
    lat: sensor.lat,
    lng: sensor.lng,
    lastSeenAt: (reading.observedAt ?? sensor.lastSeenAt)?.toISOString() ?? null,
  });

  // тревога — только на ПЕРЕХОДЕ из нормального состояния (edge-trigger)
  const isAlerting = newStatus === 'ALERT' || newStatus === 'STALE';
  const wasAlerting = prevStatus === 'ALERT' || prevStatus === 'STALE';
  if (!isAlerting || wasAlerting) return;

  const message = stale ? `Нет данных более ${STALE_MINUTES} мин` : reasons.join('; ');
  logger.warn({ msg: '🔴 SENSOR ALERT', sensor: sensor.name, status: newStatus, message });

  const alertPayload = {
    sensorId: sensor.id,
    name: sensor.name,
    kind: sensor.kind,
    status: newStatus,
    message,
    temperature: reading.temperature,
    humidity: reading.humidity,
    groupId: sensor.groupId,
    lat: sensor.lat,
    lng: sensor.lng,
    at: now.toISOString(),
  };

  io.to(`org:${sensor.organizationId}`).emit('sensor-alert', alertPayload);
  if (sensor.groupId) io.to(sensor.groupId).emit('sensor-alert', alertPayload);

  // push участникам группы датчика
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
        status: newStatus,
        message,
      }).catch((err) => logger.warn({ msg: 'sensor push failed', sensorId: sensor.id, err }));
    }
  }
}
