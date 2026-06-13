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
const CLEAR_LINGER_MS = 2 * 60_000; // инцидент закрываем только после N тишины (схлопывает серии движений в один инцидент = один пуш)

// Импульс-метрики: батарейный PIR в deep sleep будит плату только по ПОДЪЁМУ движения,
// шлёт motion:true и засыпает — motion:false из сна НЕ приходит никогда. Без авто-сброса
// motion залипает в true → следующее движение не даёт фронта false→true → нет пуша.
// Поэтому такие метрики трактуем как событие-импульс: открытый инцидент авто-гасим через
// EVENT_AUTORESET_MS после ПОСЛЕДНЕГО true (метка lastNotifiedAt обновляется на каждом true).
const EVENT_METRICS = new Set<string>(['motion']);
const EVENT_AUTORESET_MS = 60_000; // тишина дольше → импульс-инцидент авто-закрывается

function isEventMetric(metric: string | null | undefined): boolean {
  return !!metric && EVENT_METRICS.has(metric);
}

// Дебаунс: ключ `${sensorId}:${ruleId}` → когда правило начало срабатывать (ms).
const pendingSince = new Map<string, number>();
// Linger: ключ `${sensorId}:${ruleId}` → когда правило перестало срабатывать (ms).
const clearingSince = new Map<string, number>();

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
    armed: sensor.armed,
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

  // открыть новые — только если датчик НА ОХРАНЕ (disarmed: телеметрия пишется, алерты молчат)
  if (sensor.armed) {
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
  }

  // закрыть решённые (с linger: не закрываем на первом тихом замере, чтобы серия
  // движений не плодила инциденты/пуши; закрываем только после CLEAR_LINGER_MS тишины).
  // Снятие с охраны (disarmed) гасит любые открытые инциденты сразу, без linger.
  for (const inc of openIncidents) {
    const rid = inc.ruleId ?? '';
    const key = `${sensor.id}:${rid}`;
    if (sensor.armed && activeNow.has(rid)) {
      clearingSince.delete(key); // снова активно — отменяем отложенное закрытие
      // импульс-метрика (motion): обновляем «последний раз активно», чтобы авто-сброс
      // отсчитывался от ПОСЛЕДНЕГО движения (серия движений = один инцидент = один пуш).
      if (isEventMetric(inc.metric)) {
        await prisma.incident.update({ where: { id: inc.id }, data: { lastNotifiedAt: now } });
      }
      continue;
    }
    if (!sensor.armed) {
      clearingSince.delete(key); // снято с охраны — закрываем немедленно
    } else if (rid === STALE_RULE_ID) {
      // данные вернулись — STALE снимаем сразу, без linger
      clearingSince.delete(key);
    } else {
      const since = clearingSince.get(key);
      if (since === undefined) { clearingSince.set(key, now.getTime()); continue; } // старт тишины
      if (now.getTime() - since < CLEAR_LINGER_MS) continue; // ещё в окне linger — держим открытым
      clearingSince.delete(key);
    }
    await prisma.incident.update({ where: { id: inc.id }, data: { status: 'RESOLVED', resolvedAt: now } });
    logger.info({ msg: '✅ INCIDENT RESOLVED', sensor: sensor.name, ruleId: inc.ruleId });
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
  // Один emit с объединением комнат: socket.io шлёт сокету, состоящему и в org-,
  // и в group-комнате, ОДИН раз (раньше два отдельных emit давали дубль уведомления
  // тем, кто член группы датчика; кто только в org — получал один раз).
  const target = sensor.groupId
    ? io.to(`org:${sensor.organizationId}`).to(sensor.groupId)
    : io.to(`org:${sensor.organizationId}`);
  target.emit('sensor-alert', payload);

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

// ── Авто-сброс импульс-метрик (motion и т.п.) ───────────────────────────────
// Спящий PIR не присылает motion:false — поэтому открытый импульс-инцидент гасим
// сами через EVENT_AUTORESET_MS после последнего true. Без этого motion залипает true
// и следующее движение не даёт фронта false→true → нет нового пуша.
// Вызывается из поллера на общем таймере (motion — PUSH, поллер его не опрашивает).
export async function sweepEventIncidents(io: Server): Promise<void> {
  const cutoff = new Date(Date.now() - EVENT_AUTORESET_MS);
  let stale: Array<{ id: string; sensorId: string; ruleId: string | null; metric: string | null }>;
  try {
    stale = await prisma.incident.findMany({
      where: {
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        metric: { in: [...EVENT_METRICS] },
        lastNotifiedAt: { lt: cutoff },
      },
      select: { id: true, sensorId: true, ruleId: true, metric: true },
    });
  } catch (err) {
    logger.warn({ msg: 'sweepEventIncidents: не удалось прочитать инциденты', err });
    return;
  }
  if (stale.length === 0) return;

  const now = new Date();
  for (const inc of stale) {
    try {
      await prisma.incident.update({ where: { id: inc.id }, data: { status: 'RESOLVED', resolvedAt: now } });
      // чистим in-memory дебаунс/linger по этому правилу — следующее движение стартует с нуля
      const key = `${inc.sensorId}:${inc.ruleId ?? ''}`;
      pendingSince.delete(key);
      clearingSince.delete(key);

      const sensor = await prisma.sensor.findUnique({ where: { id: inc.sensorId } });
      if (!sensor) continue;

      // гасим импульс-метрику в lastValue, чтобы панель показала отбой
      const lastValue = { ...((sensor.lastValue as Metrics) ?? {}) };
      if (inc.metric) lastValue[inc.metric] = false;

      // статус OK только если других открытых инцидентов нет
      const otherOpen = await prisma.incident.count({
        where: { sensorId: sensor.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      });
      const newStatus: Sensor['status'] = otherOpen > 0 ? 'ALERT' : 'OK';

      await prisma.sensor.update({ where: { id: sensor.id }, data: { lastValue: lastValue as object, status: newStatus } });

      io.to(`org:${sensor.organizationId}`).emit('sensor-update', {
        id: sensor.id,
        name: sensor.name,
        kind: sensor.kind,
        status: newStatus,
        armed: sensor.armed,
        metrics: lastValue,
        temperature: num(lastValue.temperature),
        humidity: num(lastValue.humidity),
        lat: sensor.lat,
        lng: sensor.lng,
        lastSeenAt: sensor.lastSeenAt?.toISOString() ?? null,
      });
      logger.info({ msg: '⏱️ EVENT AUTO-RESET', sensor: sensor.name, metric: inc.metric });
    } catch (err) {
      logger.warn({ msg: 'sweepEventIncidents: не удалось закрыть инцидент', incidentId: inc.id, err });
    }
  }
}
