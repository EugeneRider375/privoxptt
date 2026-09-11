// Автоудаление устаревших геоданных (D52).
//
// User.lastLat/lastLng/lastLocationAt (D35) и ArrivalCheckIn (D53) писались
// без срока хранения — реальный разрыв с принципом ограничения хранения
// GDPR (ст. 5(1)(e)): персональные данные нельзя хранить дольше, чем нужно
// для цели обработки. GDPR не задаёт конкретное число дней — берём тот же
// срок, что уже согласован для сообщений (D32), чтобы не плодить разные
// политики хранения без причины.
//
// Запускается graceful'но (как messageCleanup): если очистка падает —
// основной PTT/WebRTC-сервер продолжает работать как ни в чём не бывало.

import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';
import { MESSAGE_RETENTION_MS } from './messageCleanup';

export const LOCATION_RETENTION_MS = MESSAGE_RETENTION_MS; // 30 дней
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // раз в час — само удаление дешёвое

let timer: NodeJS.Timeout | null = null;

export function startLocationCleanup(): void {
  if (timer) return;
  logger.info({ msg: '🧹 Автоудаление геоданных запущено', retentionDays: LOCATION_RETENTION_MS / 86_400_000 });
  void cleanupOldLocations();
  timer = setInterval(() => void cleanupOldLocations(), CLEANUP_INTERVAL_MS);
}

export function stopLocationCleanup(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Экспортирована для тестов и ручного запуска.
export async function cleanupOldLocations(): Promise<{ clearedPositions: number; deletedArrivals: number }> {
  const cutoff = new Date(Date.now() - LOCATION_RETENTION_MS);

  // Саму запись о пользователе не трогаем — только устаревшую координату,
  // которая уже и так не показывается диспетчеру дальше LOCATION_STALE_MS
  // (24ч, locations.ts), но до сих пор оставалась в базе бессрочно.
  const { count: clearedPositions } = await prisma.user.updateMany({
    where: { lastLocationAt: { lt: cutoff } },
    data: { lastLat: null, lastLng: null, lastHeading: null, lastSpeed: null, lastLocationAt: null },
  });

  const { count: deletedArrivals } = await prisma.arrivalCheckIn.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  if (clearedPositions > 0 || deletedArrivals > 0) {
    logger.info({ msg: '🧹 Автоудаление геоданных: очищено', clearedPositions, deletedArrivals });
  }
  return { clearedPositions, deletedArrivals };
}
