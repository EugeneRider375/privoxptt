// Telegram-уведомления (Privox Monitor — фаза 1 оповещений).
// Шлёт алармы датчиков в Telegram-чат через Bot API.
// No-op, если не сконфигурено (нет TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) —
// прод без настройки не падает, просто молчит. Секреты — только из env.

import { logger } from '../utils/logger';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT = process.env.TELEGRAM_CHAT_ID;

export function telegramEnabled(): boolean {
  return Boolean(TOKEN && DEFAULT_CHAT);
}

// Отправка простого текстового сообщения. chatId по умолчанию — из env (демо-чат).
// Возвращает true при успехе. Любые ошибки логируются и НЕ пробрасываются
// (уведомление не должно ронять обработку телеметрии).
export async function sendTelegram(text: string, chatId = DEFAULT_CHAT): Promise<boolean> {
  if (!TOKEN || !chatId) return false; // не сконфигурено — тихо выходим
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ msg: 'telegram send failed', status: res.status, body });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ msg: 'telegram send error', err });
    return false;
  }
}
