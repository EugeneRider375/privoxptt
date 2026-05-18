import * as mediasoup from 'mediasoup';
import type { Worker, Router, RtpCapabilities } from 'mediasoup/node/lib/types';
import { config } from '../config';
import { logger } from '../utils/logger';

// ─── Конфигурация MediaSoup ───────────────────────────────
const WORKER_SETTINGS: mediasoup.types.WorkerSettings = {
  logLevel: config.isDev ? 'debug' : 'warn',
  logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
  rtcMinPort: config.MEDIASOUP_MIN_PORT,
  rtcMaxPort: config.MEDIASOUP_MAX_PORT,
};

// Аудио кодеки — Opus оптимален для речи (PTT)
export const MEDIA_CODECS: mediasoup.types.RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    parameters: {
      'sprop-stereo': 1,
      'useinbandfec': 1,      // FEC — восстановление пакетов
      'usedtx': 1,            // DTX — тишина не передаётся (экономия)
      minptime: 10,
      maxptime: 60,
    },
  },
];

// ─── Менеджер Workers ─────────────────────────────────────
class MediasoupManager {
  private workers: Worker[] = [];
  private workerIndex = 0;

  // Роутеры по группам: groupId → Router
  private groupRouters = new Map<string, Router>();
  // Предотвращает гонку: два параллельных запроса не создадут два роутера
  private groupRouterCreating = new Map<string, Promise<Router>>();

  async init(): Promise<void> {
    const numWorkers = config.MEDIASOUP_NUM_WORKERS;
    logger.info({ msg: `Создание ${numWorkers} MediaSoup worker(s)` });

    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker(WORKER_SETTINGS);

      worker.on('died', (err) => {
        logger.error({ msg: `MediaSoup worker #${i} упал`, err });
        // Пересоздаём воркер
        this.replaceWorker(i);
      });

      this.workers.push(worker);
      logger.info({ msg: `MediaSoup worker #${i} запущен`, pid: worker.pid });
    }
  }

  private async replaceWorker(index: number): Promise<void> {
    try {
      const worker = await mediasoup.createWorker(WORKER_SETTINGS);
      worker.on('died', () => this.replaceWorker(index));
      this.workers[index] = worker;
      logger.info({ msg: `MediaSoup worker #${index} пересоздан` });
    } catch (err) {
      logger.error({ msg: `Ошибка пересоздания worker #${index}`, err });
    }
  }

  // Round-robin выбор воркера
  private getNextWorker(): Worker {
    const worker = this.workers[this.workerIndex];
    this.workerIndex = (this.workerIndex + 1) % this.workers.length;
    return worker;
  }

  // Получить или создать роутер для группы (конкурентно-безопасно)
  async getOrCreateGroupRouter(groupId: string): Promise<Router> {
    const existing = this.groupRouters.get(groupId);
    if (existing && !existing.closed) return existing;

    // Если создание уже идёт — вернуть тот же Promise, не создавать второй роутер
    const inProgress = this.groupRouterCreating.get(groupId);
    if (inProgress) return inProgress;

    const promise = (async () => {
      const worker = this.getNextWorker();
      const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
      router.on('@close', () => {
        this.groupRouters.delete(groupId);
        logger.debug({ msg: 'Роутер группы закрыт', groupId });
      });
      this.groupRouters.set(groupId, router);
      logger.debug({ msg: 'Роутер группы создан', groupId });
      return router;
    })();

    this.groupRouterCreating.set(groupId, promise);
    promise.finally(() => this.groupRouterCreating.delete(groupId));

    return promise;
  }

  getWorkerCount(): number {
    return this.workers.length;
  }

  getGroupRouter(groupId: string): Router | undefined {
    return this.groupRouters.get(groupId);
  }

  closeGroupRouter(groupId: string): void {
    const router = this.groupRouters.get(groupId);
    if (router && !router.closed) {
      router.close();
    }
    this.groupRouters.delete(groupId);
  }

  async getRtpCapabilities(groupId: string): Promise<RtpCapabilities> {
    const router = await this.getOrCreateGroupRouter(groupId);
    return router.rtpCapabilities;
  }

  async close(): Promise<void> {
    for (const router of this.groupRouters.values()) {
      router.close();
    }
    for (const worker of this.workers) {
      worker.close();
    }
    logger.info('MediaSoup остановлен');
  }
}

export const mediasoupManager = new MediasoupManager();
