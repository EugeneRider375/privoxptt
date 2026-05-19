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

import { authRouter } from './routes/auth';
import { organizationsRouter } from './routes/organizations';
import { usersRouter } from './routes/users';
import { groupsRouter } from './routes/groups';
import { activityRouter } from './routes/activity';
import { errorHandler, notFound } from './middleware/errorHandler';

async function bootstrap() {
  const app = express();

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
    });
  });

  // ─── API маршруты ─────────────────────────────────────────
  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/orgs', organizationsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/groups', groupsRouter);
  app.use('/api/activity', activityRouter);

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
