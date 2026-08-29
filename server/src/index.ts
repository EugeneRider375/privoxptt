import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config } from './config';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './database/prisma';
import { connectRedis, disconnectRedis } from './database/redis';
import { setupSocketIO } from './socket';
import { mediasoupManager } from './mediasoup/server';

import { startUdpBridge } from './udp-bridge';
import { startSensorPoller } from './services/sensorPoller';
import { startMessageCleanup } from './services/messageCleanup';
import { authRouter } from './routes/auth';
import { organizationsRouter } from './routes/organizations';
import { usersRouter } from './routes/users';
import { groupsRouter } from './routes/groups';
import { locationsRouter } from './routes/locations';
import { onboardingRouter } from './routes/onboarding';
import { invitesRouter } from './routes/invites';
import { activityRouter } from './routes/activity';
import { devicesRouter } from './routes/devices';
import { callsRouter } from './routes/calls';
import { messagesRouter } from './routes/messages';
import { sensorsRouter } from './routes/sensors';
import { telemetryRouter } from './routes/telemetry';
import { publicRouter } from './routes/public';
import { errorHandler, notFound } from './middleware/errorHandler';
import { isApnsConfigured } from './services/apns';

async function bootstrap() {
  const app = express();

  // За реверс-прокси (Coolify/Traefik) — доверяем первому хопу, иначе express-rate-limit
  // ругается на X-Forwarded-For (ValidationError) и неверно кеит лимиты по IP.
  app.set('trust proxy', 1);

  // ─── Безопасность ─────────────────────────────────────────
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  app.use(cors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Глобальный rate limit — 200 запросов в минуту
  app.use(rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please wait a minute' },
  }));

  // Жёсткий rate limit для auth — 10 попыток в минуту
  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    message: { error: 'Too many login attempts' },
  });

  // ─── Парсинг тела запроса ─────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ─── Healthcheck ──────────────────────────────────────────
  app.get('/health', (_req, res) => {
    const msWorkers = mediasoupManager.getWorkerCount();
    res.json({
      status: 'ok',
      service: 'PrivoxPTT',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      arch: process.arch,
      mediasoup: { workers: msWorkers, ok: msWorkers > 0, error: mediasoupManager.initError },
      // Настроен ли push на iPhone. Снаружи это иначе никак не видно, а когда
      // звонок не прозвонит, первым делом надо знать, чья это половина —
      // серверная или нативная. Секретов не раскрываем: только факт наличия
      // ключа и окружение, в которое уйдёт push (перепутать sandbox с
      // production легко, а push «не туда» молча не доходит).
      apns: { configured: isApnsConfigured(), env: config.APNS_ENV },
    });
  });

  // ─── API маршруты ─────────────────────────────────────────
  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/orgs', organizationsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/locations', locationsRouter);
  app.use('/api/groups', groupsRouter);
  app.use('/api/onboarding', onboardingRouter); // вопросник суперадмина: группа + участники + приглашения
  app.use('/api/invites', invitesRouter);       // активация по персональному QR (без JWT — токен и есть удостоверение)
  app.use('/api/activity', activityRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/calls', callsRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/sensors', sensorsRouter);
  app.use('/api/telemetry', telemetryRouter); // push-телеметрия (ключ датчика, без JWT)
  app.use('/api/public', publicRouter);       // read-only чтение датчиков (read-ключ, без JWT) — для дисплеев

  // ─── 404 и обработка ошибок ───────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  // ─── HTTP сервер ──────────────────────────────────────────
  const httpServer = http.createServer(app);

  // ─── Socket.io ────────────────────────────────────────────
  const io = setupSocketIO(httpServer);
  app.set('io', io);

  // ─── Инициализация сервисов ───────────────────────────────
  await connectDatabase();
  await connectRedis();

  // MediaSoup — graceful: PTT сигналинг работает без него, только без аудио
  try {
    await mediasoupManager.init();
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    mediasoupManager.initError = errMsg;
    logger.warn({ msg: '⚠️  MediaSoup не запустился — аудио недоступно, сигналинг работает', err: errMsg });
  }

  // ESP32 UDP bridge — graceful: основной сервер работает даже если bridge упал
  try {
    startUdpBridge(io);
  } catch (err) {
    logger.warn({ msg: '⚠️  ESP32 UDP bridge не запустился — PTT через веб продолжает работать', err });
  }

  // Sensor poller — graceful: PTT/WebRTC работают даже если поллер не стартовал
  try {
    startSensorPoller(io);
  } catch (err) {
    logger.warn({ msg: '⚠️  Sensor poller не запустился — связь продолжает работать', err });
  }

  // Автоудаление старых сообщений/вложений — graceful, по той же схеме
  try {
    startMessageCleanup();
  } catch (err) {
    logger.warn({ msg: '⚠️  Автоудаление сообщений не запустилось — сообщения продолжают работать', err });
  }

  // ─── Запуск ───────────────────────────────────────────────
  httpServer.listen(config.PORT, config.HOST, () => {
    logger.info({
      msg: '🎙️  PrivoxPTT сервер запущен',
      url: `http://${config.HOST}:${config.PORT}`,
      env: config.NODE_ENV,
    });
  });

  // ─── Graceful shutdown ────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ msg: `Получен ${signal}, завершение...` });

    httpServer.close(async () => {
      await mediasoupManager.close();
      await disconnectDatabase();
      await disconnectRedis();
      logger.info('Сервер остановлен');
      process.exit(0);
    });

    // Принудительный выход через 10 секунд
    setTimeout(() => {
      logger.error('Принудительный выход по таймауту');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ msg: 'Необработанный Promise rejection', reason });
  });

  process.on('uncaughtException', (err) => {
    logger.error({ msg: 'Необработанное исключение', err });
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error('Ошибка запуска сервера:', err);
  process.exit(1);
});
