// Автоудаление старых сообщений и их вложений.
// Решение Eugene 2026-08-28: единый срок хранения для всех организаций и
// групп (не настраивается per-organization) — вложения (фото) со временем
// накапливаются на диске сервера, а места на нём ограничено.
//
// Запускается graceful'но (как sensorPoller/udpBridge): если очистка падает —
// основной PTT/WebRTC-сервер продолжает работать как ни в чём не бывало.

import { unlink } from 'fs/promises';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';

export const MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // раз в час — само удаление дешёвое

let timer: NodeJS.Timeout | null = null;

export function startMessageCleanup(): void {
  if (timer) return;
  logger.info({ msg: '🧹 Автоудаление сообщений запущено', retentionDays: MESSAGE_RETENTION_MS / 86_400_000 });
  void cleanupOldMessages();
  timer = setInterval(() => void cleanupOldMessages(), CLEANUP_INTERVAL_MS);
}

export function stopMessageCleanup(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Экспортирована для тестов и ручного запуска.
export async function cleanupOldMessages(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - MESSAGE_RETENTION_MS);

  const old = await prisma.message.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, attachmentPath: true },
  });
  if (old.length === 0) return { deleted: 0 };

  // Файлы удаляем ДО записей в базе: если сервер упадёт посреди работы,
  // лучше осиротевшая запись без файла (безвредно), чем файл без записи,
  // который никогда не найдётся и не удалится.
  for (const message of old) {
    if (!message.attachmentPath) continue;
    try {
      await unlink(message.attachmentPath);
    } catch (err) {
      // Файла может не быть (ручная чистка, повторный запуск после сбоя) —
      // это не повод останавливать всю очистку.
      logger.warn({ msg: 'message cleanup: не удалось удалить файл вложения', path: message.attachmentPath, err });
    }
  }

  const { count } = await prisma.message.deleteMany({ where: { id: { in: old.map((m) => m.id) } } });
  logger.info({ msg: '🧹 Автоудаление сообщений: очищено', count });
  return { deleted: count };
}
