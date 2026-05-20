import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
});

redis.on('connect', () => logger.info('Redis подключён'));
redis.on('ready', () => logger.debug('Redis готов к работе'));
redis.on('error', (err) => logger.error({ msg: 'Redis ошибка', err }));
redis.on('close', () => logger.warn('Redis соединение закрыто'));
redis.on('reconnecting', () => logger.warn('Redis переподключение...'));

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  logger.info('Redis отключён');
}

// ─── PTT ключи ───────────────────────────────────────────
export const PTT_LOCK_PREFIX = 'ptt:group:';
export const PTT_LOCK_TTL = 8; // секунды — автоматический сброс если клиент упал

export async function acquirePttLock(
  groupId: string,
  userId: string
): Promise<boolean> {
  const key = `${PTT_LOCK_PREFIX}${groupId}`;
  // SET NX EX — атомарная операция, не заблокирует если уже занято
  const result = await redis.set(key, userId, 'EX', PTT_LOCK_TTL, 'NX');
  return result === 'OK';
}

export async function releasePttLock(
  groupId: string,
  userId: string
): Promise<boolean> {
  const key = `${PTT_LOCK_PREFIX}${groupId}`;
  const current = await redis.get(key);
  if (current !== userId) return false; // чужая блокировка — не трогаем
  await redis.del(key);
  return true;
}

export async function refreshPttLock(
  groupId: string,
  userId: string
): Promise<boolean> {
  const key = `${PTT_LOCK_PREFIX}${groupId}`;
  const current = await redis.get(key);
  if (current !== userId) return false;
  await redis.expire(key, PTT_LOCK_TTL);
  return true;
}

export async function getPttLockOwner(
  groupId: string
): Promise<string | null> {
  return redis.get(`${PTT_LOCK_PREFIX}${groupId}`);
}

// ─── Онлайн статусы ──────────────────────────────────────
export const ONLINE_PREFIX = 'online:user:';
export const ONLINE_SOCKET_PREFIX = 'online:sockets:user:';
export const ONLINE_TTL = 60; // секунды — heartbeat обновляет

export async function setUserOnline(userId: string, socketId: string): Promise<void> {
  const onlineKey = `${ONLINE_PREFIX}${userId}`;
  const socketsKey = `${ONLINE_SOCKET_PREFIX}${userId}`;
  await redis
    .multi()
    .sadd(socketsKey, socketId)
    .expire(socketsKey, ONLINE_TTL)
    .set(onlineKey, '1', 'EX', ONLINE_TTL)
    .exec();
}

export async function setUserOffline(userId: string, socketId?: string): Promise<boolean> {
  const onlineKey = `${ONLINE_PREFIX}${userId}`;
  const socketsKey = `${ONLINE_SOCKET_PREFIX}${userId}`;

  if (socketId) {
    await redis.srem(socketsKey, socketId);
    const remainingSockets = await redis.scard(socketsKey);
    if (remainingSockets > 0) {
      await redis
        .multi()
        .expire(socketsKey, ONLINE_TTL)
        .expire(onlineKey, ONLINE_TTL)
        .exec();
      return false;
    }
  }

  const wasOnline = await redis.exists(onlineKey);
  await redis.del(onlineKey, socketsKey);
  return wasOnline === 1;
}

export async function isUserOnline(userId: string): Promise<boolean> {
  const val = await redis.exists(`${ONLINE_PREFIX}${userId}`);
  return val === 1;
}

export async function refreshUserOnline(userId: string): Promise<void> {
  await redis
    .multi()
    .expire(`${ONLINE_PREFIX}${userId}`, ONLINE_TTL)
    .expire(`${ONLINE_SOCKET_PREFIX}${userId}`, ONLINE_TTL)
    .exec();
}

export async function getOnlineUserIds(): Promise<string[]> {
  const keys = await redis.keys(`${ONLINE_PREFIX}*`);
  return keys.map((k) => k.replace(ONLINE_PREFIX, ''));
}
