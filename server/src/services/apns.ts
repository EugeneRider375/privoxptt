import http2 from 'http2';
import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';

import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Отправка push в Apple Push Notification service напрямую.
 *
 * Почему не через Firebase, как Android: FCM умеет обычные уведомления, но
 * НЕ умеет VoIP-push. А для звонка на спящий iPhone нужен именно он — только
 * VoIP-push поднимает приложение из выгруженного состояния и даёт показать
 * нативный экран входящего вызова.
 *
 * ⚠️ Жёсткое правило Apple, заложено в архитектуру с самого начала: на КАЖДЫЙ
 * доставленный VoIP-push приложение обязано отчитаться о звонке через CallKit
 * (`reportNewIncomingCall`). Не отчиталось — iOS сперва начинает придерживать
 * доставку, а затем перестаёт будить приложение вовсе. Поэтому VoIP-push шлём
 * ТОЛЬКО под настоящий звонок и никогда — под фоновые обновления.
 */

/** Живёт максимум час (требование Apple), обновляем заранее. */
const TOKEN_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const HOSTS = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
} as const;

export type ApnsPushType = 'voip' | 'alert';

export interface ApnsResult {
  ok: boolean;
  status: number;
  /** Код ошибки Apple: BadDeviceToken, Unregistered, TooManyRequests и т.п. */
  reason?: string;
}

let cachedKey: string | null = null;
let cachedToken: { value: string; madeAt: number } | null = null;
let client: http2.ClientHttp2Session | null = null;

export function isApnsConfigured(): boolean {
  return Boolean((config.APNS_KEY || config.APNS_KEY_PATH) && config.APNS_KEY_ID && config.APNS_TEAM_ID);
}

/**
 * Ключ приходит либо содержимым (прод: переменная окружения из Coolify, файлов
 * в контейнере нет), либо путём к файлу (машина разработчика). Содержимое
 * приоритетнее: если задано и то и другое, значит окружение задано осознанно.
 *
 * В переменной перевод строки часто приходит как литеральное \n — Coolify и
 * docker так сохраняют многострочные значения. Разворачиваем, иначе PEM не
 * распарсится, а ошибка будет невнятной.
 */
function privateKey(): string {
  if (cachedKey) return cachedKey;
  cachedKey = config.APNS_KEY
    ? config.APNS_KEY.replace(/\\n/g, '\n')
    : readFileSync(config.APNS_KEY_PATH!, 'utf8');
  return cachedKey;
}

/**
 * Токен авторизации APNs. Apple отвергает и слишком старые (>1 часа), и
 * слишком частые обновления, поэтому переиспользуем, пока свеж.
 */
export function authToken(now: number = Date.now()): string {
  if (cachedToken && now - cachedToken.madeAt < TOKEN_TTL_MS) return cachedToken.value;

  const value = jwt.sign({}, privateKey(), {
    algorithm: 'ES256',
    issuer: config.APNS_TEAM_ID,
    keyid: config.APNS_KEY_ID,
    header: { alg: 'ES256', kid: config.APNS_KEY_ID! },
  });

  cachedToken = { value, madeAt: now };
  return value;
}

/** Сбрасывает кеш ключа и токена — для тестов и после смены конфигурации. */
export function resetApnsCache(): void {
  cachedKey = null;
  cachedToken = null;
}

/**
 * Тема (topic) зависит от типа push: у VoIP к идентификатору приложения
 * добавляется `.voip`. Отправка VoIP-push с обычной темой отвергается Apple.
 */
export function topicFor(pushType: ApnsPushType, bundleId: string = config.APNS_BUNDLE_ID): string {
  return pushType === 'voip' ? `${bundleId}.voip` : bundleId;
}

function session(): http2.ClientHttp2Session {
  if (client && !client.closed && !client.destroyed) return client;

  const host = HOSTS[config.APNS_ENV];
  client = http2.connect(host);
  client.on('error', (err) => {
    logger.warn({ msg: 'APNs: соединение оборвалось', err: String(err) });
    client = null;
  });
  client.on('close', () => { client = null; });
  return client;
}

/**
 * Одна отправка. Ошибку не бросаем: недоставленный push не должен ронять
 * вызов — у человека остаются другие каналы (сокет, рация, обычный звонок).
 */
export async function sendApns(
  deviceToken: string,
  payload: Record<string, unknown>,
  options: { pushType: ApnsPushType; priority?: 5 | 10; expirationSec?: number; collapseId?: string },
): Promise<ApnsResult> {
  if (!isApnsConfigured()) {
    return { ok: false, status: 0, reason: 'ApnsNotConfigured' };
  }

  const body = Buffer.from(JSON.stringify(payload));

  return new Promise<ApnsResult>((resolve) => {
    let settled = false;
    const done = (result: ApnsResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const req = session().request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${authToken()}`,
        'apns-topic': topicFor(options.pushType),
        'apns-push-type': options.pushType,
        // VoIP обязан быть немедленным: он поднимает экран звонка.
        'apns-priority': String(options.priority ?? 10),
        'apns-expiration': String(
          options.expirationSec === undefined
            ? Math.floor(Date.now() / 1000) + 45   // столько же, сколько звонит вызов
            : options.expirationSec,
        ),
        ...(options.collapseId ? { 'apns-collapse-id': options.collapseId } : {}),
        'content-type': 'application/json',
        'content-length': String(body.length),
      });

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.close(http2.constants.NGHTTP2_CANCEL);
        done({ ok: false, status: 0, reason: 'Timeout' });
      });

      let status = 0;
      let raw = '';
      req.on('response', (headers) => { status = Number(headers[':status']) || 0; });
      req.on('data', (chunk) => { raw += chunk; });
      req.on('error', (err) => done({ ok: false, status: 0, reason: String(err) }));
      req.on('end', () => {
        if (status === 200) return done({ ok: true, status });
        let reason: string | undefined;
        try { reason = JSON.parse(raw).reason; } catch { /* тело может быть пустым */ }
        done({ ok: false, status, reason });
      });

      req.end(body);
    } catch (err) {
      done({ ok: false, status: 0, reason: String(err) });
    }
  });
}

/** Токены, которые Apple объявила мёртвыми — такие устройства надо отключать. */
export function isDeadTokenReason(reason?: string): boolean {
  return reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic';
}
