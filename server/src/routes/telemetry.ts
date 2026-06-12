// Push-протокол телеметрии: устройство (ESP/LoRa-шлюз) шлёт метрики напрямую.
// Аутентификация по ключу датчика (X-Sensor-Key или поле key), БЕЗ JWT.
//   POST /api/telemetry
//   Header: X-Sensor-Key: <ключ>
//   { "metrics": { "waterLevel": 82, "leak": true }, "ts": 1718000000 }

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Server } from 'socket.io';
import { prisma } from '../database/prisma';
import { processReading } from '../services/sensors/process';

export const telemetryRouter = Router();

const telemetrySchema = z.object({
  key: z.string().max(128).optional(),
  ts: z.number().optional(), // опц. время устройства (информационно); для свежести берём серверное
  metrics: z.record(z.union([z.number(), z.boolean()])),
  setArmed: z.boolean().optional(), // событие с кнопки на плате: запрос снять/поставить на охрану
});

telemetryRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = telemetrySchema.parse(req.body);
    const key = (req.header('X-Sensor-Key') ?? data.key ?? '').trim();
    if (!key) {
      res.status(401).json({ error: 'Sensor key required' });
      return;
    }

    const sensor = await prisma.sensor.findUnique({ where: { sensorKey: key } });
    if (!sensor || !sensor.enabled || sensor.ingest !== 'PUSH') {
      res.status(401).json({ error: 'Invalid sensor key' });
      return;
    }

    const io = req.app.get('io') as Server | undefined;
    if (!io) {
      res.status(503).json({ error: 'Service not ready' });
      return;
    }

    // Кнопка на плате (событие): меняем armed ДО обработки, чтобы тот же замер уже
    // подавлялся/разрешался, а диспетчер увидел смену мгновенно (через sensor-update).
    if (data.setArmed !== undefined && data.setArmed !== sensor.armed) {
      await prisma.sensor.update({ where: { id: sensor.id }, data: { armed: data.setArmed } });
      sensor.armed = data.setArmed; // для processReading в этом же запросе
    }

    // observedAt = серверное время приёма (push = данные только что пришли).
    await processReading(io, sensor, data.metrics, { observedAt: new Date(), raw: req.body });

    // Возвращаем актуальное состояние охраны — плата красит LED и синхронизируется
    // с удалёнными изменениями диспетчера (узнаёт о них на ближайшем heartbeat).
    res.json({ ok: true, armed: sensor.armed });
  } catch (err) {
    next(err);
  }
});
