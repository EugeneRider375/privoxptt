import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET должен быть минимум 32 символа'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  REFRESH_TOKEN_SECRET: z.string().min(32, 'REFRESH_TOKEN_SECRET должен быть минимум 32 символа'),
  // Год, а не 30 дней: рации и телефоны логинятся один раз, дальше токен
  // ротируется при каждом запуске приложения. 30 дней означало, что устройство,
  // пролежавшее месяц без дела, требовало повторного ввода логина и пароля.
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('365d'),

  MEDIASOUP_LISTEN_IP: z.string().default('0.0.0.0'),
  MEDIASOUP_ANNOUNCED_IP: z.string().default('127.0.0.1'),
  MEDIASOUP_MIN_PORT: z.coerce.number().default(10000),
  MEDIASOUP_MAX_PORT: z.coerce.number().default(10100),
  MEDIASOUP_NUM_WORKERS: z.coerce.number().default(1),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  SUPERADMIN_EMAIL: z.string().email().optional(),
  SUPERADMIN_PASSWORD: z.string().min(8).optional(),
  SUPERADMIN_CALLSIGN: z.string().default('ALPHA-0'),

  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  // ─── APNs: push на iPhone ────────────────────────────────────────────────
  // Firebase на iOS не годится для звонка: FCM умеет обычные уведомления, а
  // VoIP-push (PushKit) — отдельный тип, его шлют только напрямую в APNs.
  // Ключ .p8 не истекает; при создании Apple отдаёт файл ровно один раз.
  // Два способа отдать ключ, и оба нужны:
  //   APNS_KEY_PATH — путь к файлу. Удобно на машине разработчика.
  //   APNS_KEY      — содержимое .p8 целиком. Так работает ПРОД: контейнер
  //                   собирается из образа, файлов туда никто не монтирует, а
  //                   секреты приходят переменными окружения из Coolify —
  //                   ровно как FIREBASE_SERVICE_ACCOUNT_JSON рядом.
  // Если заданы оба, содержимое имеет приоритет над путём.
  APNS_KEY_PATH: z.string().optional(),
  APNS_KEY: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().default('tech.privox.ptt'),
  /**
   * Сборка из Xcode на устройство ходит в sandbox, TestFlight и App Store —
   * в production. Ключ .p8 годен для обоих, но АДРЕС РАЗНЫЙ, и push, отправленный
   * не туда, молча не доходит. Ошибиться здесь легко, а найти трудно.
   */
  APNS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),

  SERVICE_URL_WEB: z.string().url().optional(),

  // Адрес, который попадает в ссылку приглашения (QR): <адрес>/join/<токен>.
  // Не задан — берём SERVICE_URL_WEB, затем первый https из CORS_ORIGINS.
  PUBLIC_WEB_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Ошибка конфигурации окружения:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const corsOrigins = parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim());

export const config = {
  ...parsed.data,
  corsOrigins,
  isProd: parsed.data.NODE_ENV === 'production',
  isDev: parsed.data.NODE_ENV === 'development',
  publicWebUrl:
    parsed.data.PUBLIC_WEB_URL ||
    parsed.data.SERVICE_URL_WEB ||
    corsOrigins.find((o) => o.startsWith('https://')) ||
    corsOrigins[0] ||
    'http://localhost:5173',
};
