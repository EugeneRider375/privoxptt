-- Per-account Telegram chat id for sensor alerts.
ALTER TABLE "Organization" ADD COLUMN "telegramChatId" TEXT;
