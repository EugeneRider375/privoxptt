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
  type NormalizedReading,
} from './sensors/adapters';
import { processReading, sweepEventIncidents } from './sensors/process';

const POLL_INTERVAL_MS = 15_000; // как часто опрашиваем датчики
const FETCH_TIMEOUT_MS = 8_000;

let timer: NodeJS.Timeout | null = null;

export function startSensorPoller(io: Server): void {
  if (timer) return;
  logger.info({ msg: '🌡️  Sensor poller запущен', intervalMs: POLL_INTERVAL_MS });
  // первый прогон сразу, затем по интервалу
  void pollOnce(io);
  void sweepEventIncidents(io);
  timer = setInterval(() => {
    void pollOnce(io);
    void sweepEventIncidents(io); // авто-сброс импульс-метрик (motion) для PUSH-датчиков
  }, POLL_INTERVAL_MS);
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
  // Вся логика (метрики→правила→инциденты→emit) — в общем processReading.
  await processReading(io, sensor, reading.metrics, { observedAt: reading.observedAt, raw: json });
}
