import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { config } from '../config';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';
import { isApnsConfigured, isDeadTokenReason, sendApns } from './apns';

export interface IncomingUserCallPush {
  callId: string;
  fromUserId: string;
  fromCallsign: string;
  fromDisplayName: string;
  groupId: string;
  groupName: string;
  createdAt: number;
  responseToken: string;
  kind: 'user' | 'group';
}

export interface MissedCallPush {
  callId: string;
  fromUserId: string;
  fromCallsign: string;
  fromDisplayName: string;
  groupId: string;
  groupName: string;
  kind: 'user' | 'group';
}

export interface IncomingMessagePush {
  messageId: string;
  senderId: string;
  senderCallsign: string;
  senderDisplayName: string;
  body: string;
  groupId?: string;
  groupName?: string;
  unreadCount: number;
}

let firebaseReady = false;

function initFirebase(): boolean {
  if (firebaseReady) return true;
  if (getApps().length > 0) {
    firebaseReady = true;
    return true;
  }

  try {
    if (config.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(config.FIREBASE_SERVICE_ACCOUNT_JSON);
      initializeApp({ credential: cert(serviceAccount) });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: applicationDefault() });
    } else {
      logger.warn('Firebase Admin is not configured; Android wake calls are disabled');
      return false;
    }
    firebaseReady = true;
    logger.info('Firebase Admin initialized');
    return true;
  } catch (err) {
    logger.error({ msg: 'Firebase Admin initialization failed', err });
    return false;
  }
}

/**
 * Есть ли куда слать push. По этому признаку рисуется «синий» кружок
 * достижимости и принимается решение доставлять ли вызов вообще
 * (`deliverUserCall` в socket/ptt.ts), поэтому врать он не должен.
 *
 * Раньше считалось любое включённое устройство. Этого мало: у записи может не
 * остаться НИ ОДНОГО токена — например, когда Apple объявила VoIP-токен мёртвым
 * и мы его обнулили. Такое устройство недостижимо, а показывалось достижимым, и
 * вызов отчитывался доставленным, хотя отправлять было некуда.
 */
export async function hasReachablePushDevice(userId: string): Promise<boolean> {
  const count = await prisma.device.count({
    where: {
      userId,
      enabled: true,
      OR: [{ pushToken: { not: null } }, { voipToken: { not: null } }],
    },
  });
  return count > 0;
}

/**
 * Prisma не сужает тип по `not: null` в фильтре, поэтому отбираем явно.
 * Заодно страховка на случай, если запрос когда-нибудь забудут отфильтровать.
 */
function withPushToken<T extends { pushToken: string | null }>(devices: T[]): (T & { pushToken: string })[] {
  return devices.filter((d): d is T & { pushToken: string } => d.pushToken !== null);
}

/**
 * Звонок на iPhone. Отдельно от Android, потому что канал принципиально другой:
 * не FCM, а VoIP-push прямо в APNs — только он поднимает выгруженное
 * приложение и позволяет показать нативный экран входящего вызова.
 *
 * ⚠️ Нативная сторона ОБЯЗАНА на каждый такой push отчитаться о звонке через
 * CallKit. Это условие Apple: не отчитался — iOS перестанет будить приложение.
 */
async function sendIosCallPush(
  userId: string,
  payload: IncomingUserCallPush,
  responseUrl: string,
): Promise<{ sent: number; failed: number }> {
  if (!isApnsConfigured()) return { sent: 0, failed: 0 };

  const devices = await prisma.device.findMany({
    where: { userId, platform: 'IOS', enabled: true, voipToken: { not: null } },
    select: { id: true, voipToken: true },
  });
  if (devices.length === 0) return { sent: 0, failed: 0 };

  const body = {
    type: 'incoming_user_call',
    callId: payload.callId,
    fromUserId: payload.fromUserId,
    fromCallsign: payload.fromCallsign,
    fromDisplayName: payload.fromDisplayName,
    groupId: payload.groupId,
    groupName: payload.groupName,
    createdAt: payload.createdAt,
    responseToken: payload.responseToken,
    responseUrl,
    kind: payload.kind,
  };

  const results = await Promise.all(devices.map(async (device) => {
    const result = await sendApns(device.voipToken!, body, { pushType: 'voip', priority: 10 });
    return { device, result };
  }));

  const dead = results
    .filter(({ result }) => !result.ok && isDeadTokenReason(result.reason))
    .map(({ device }) => device.id);

  if (dead.length > 0) {
    // Токен мёртв — гасим сам токен, а не устройство: у него может остаться
    // рабочий обычный push-токен, и отключать его целиком было бы неверно.
    await prisma.device.updateMany({ where: { id: { in: dead } }, data: { voipToken: null } });
  }

  const sent = results.filter(({ result }) => result.ok).length;
  const failed = results.length - sent;

  logger.info({
    msg: 'iOS VoIP call push sent',
    userId,
    callId: payload.callId,
    sent,
    failed,
    reasons: results.filter(({ result }) => !result.ok).map(({ result }) => result.reason),
  });

  return { sent, failed };
}

/**
 * Звонок на телефоны получателя. Два независимых канала:
 * Android — FCM, iPhone — VoIP-push в APNs. Отправляем в оба и складываем
 * итог: у человека может быть и то, и другое устройство, и отказ одного
 * канала не должен отменять доставку по второму.
 */
export async function sendIncomingUserCallPush(
  userId: string,
  payload: IncomingUserCallPush,
): Promise<{ sent: number; failed: number }> {
  const responseUrl = `${(config.SERVICE_URL_WEB ?? config.corsOrigins[0]).replace(/\/+$/, '')}/api/calls/respond`;

  const [android, ios] = await Promise.all([
    sendAndroidCallPush(userId, payload),
    sendIosCallPush(userId, payload, responseUrl).catch((err) => {
      logger.error({ msg: 'iOS VoIP call push failed', userId, callId: payload.callId, err });
      return { sent: 0, failed: 0 };
    }),
  ]);

  return { sent: android.sent + ios.sent, failed: android.failed + ios.failed };
}

async function sendAndroidCallPush(
  userId: string,
  payload: IncomingUserCallPush,
): Promise<{ sent: number; failed: number }> {
  if (!initFirebase()) return { sent: 0, failed: 0 };

  const devices = await prisma.device.findMany({
    where: { userId, platform: 'ANDROID', enabled: true, pushToken: { not: null } },
    select: { id: true, pushToken: true },
  });
  const targets = withPushToken(devices);
  if (targets.length === 0) return { sent: 0, failed: 0 };

  const responseBaseUrl = (config.SERVICE_URL_WEB ?? config.corsOrigins[0]).replace(/\/+$/, '');
  const message: MulticastMessage = {
    tokens: targets.map((device) => device.pushToken),
    data: {
      type: 'incoming_user_call',
      callId: payload.callId,
      fromUserId: payload.fromUserId,
      fromCallsign: payload.fromCallsign,
      fromDisplayName: payload.fromDisplayName,
      groupId: payload.groupId,
      groupName: payload.groupName,
      createdAt: String(payload.createdAt),
      responseToken: payload.responseToken,
      responseUrl: `${responseBaseUrl}/api/calls/respond`,
      kind: payload.kind,
    },
    android: {
      priority: 'high',
      ttl: 45_000,
    },
  };

  let response;
  try {
    response = await getMessaging().sendEachForMulticast(message);
  } catch (err) {
    logger.error({ msg: 'Incoming user call push failed', userId, callId: payload.callId, err });
    return { sent: 0, failed: targets.length };
  }

  const invalidDeviceIds: string[] = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code ?? '';
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      invalidDeviceIds.push(targets[index].id);
    }
  });

  if (invalidDeviceIds.length > 0) {
    await prisma.device.updateMany({
      where: { id: { in: invalidDeviceIds } },
      data: { enabled: false },
    });
  }

  logger.info({
    msg: 'Incoming user call push sent',
    userId,
    callId: payload.callId,
    sent: response.successCount,
    failed: response.failureCount,
  });

  return { sent: response.successCount, failed: response.failureCount };
}

/**
 * «Пропущенный звонок» — шлётся, когда звонок провисел 45с без ответа
 * (см. `onTimeout` в `createTrackedCall`). Пока только Android (D27,
 * 2026-08-28); iOS-версия ляжет отдельным пунктом того же бэклога.
 */
export async function sendMissedCallPush(
  userId: string,
  payload: MissedCallPush,
): Promise<{ sent: number; failed: number }> {
  if (!initFirebase()) return { sent: 0, failed: 0 };

  const devices = await prisma.device.findMany({
    where: { userId, platform: 'ANDROID', enabled: true, pushToken: { not: null } },
    select: { id: true, pushToken: true },
  });
  const targets = withPushToken(devices);
  if (targets.length === 0) return { sent: 0, failed: 0 };

  const message: MulticastMessage = {
    tokens: targets.map((device) => device.pushToken),
    data: {
      type: 'missed_call',
      callId: payload.callId,
      fromUserId: payload.fromUserId,
      fromCallsign: payload.fromCallsign,
      fromDisplayName: payload.fromDisplayName,
      groupId: payload.groupId,
      groupName: payload.groupName,
      kind: payload.kind,
    },
    android: {
      priority: 'high',
      ttl: 24 * 60 * 60 * 1000,
    },
  };

  let response;
  try {
    response = await getMessaging().sendEachForMulticast(message);
  } catch (err) {
    logger.error({ msg: 'Missed call push failed', userId, callId: payload.callId, err });
    return { sent: 0, failed: targets.length };
  }

  const invalidDeviceIds: string[] = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code ?? '';
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      invalidDeviceIds.push(targets[index].id);
    }
  });

  if (invalidDeviceIds.length > 0) {
    await prisma.device.updateMany({
      where: { id: { in: invalidDeviceIds } },
      data: { enabled: false },
    });
  }

  logger.info({
    msg: 'Missed call push sent',
    userId,
    callId: payload.callId,
    sent: response.successCount,
    failed: response.failureCount,
  });

  return { sent: response.successCount, failed: response.failureCount };
}

export async function sendIncomingMessagePush(
  userId: string,
  payload: IncomingMessagePush,
): Promise<{ sent: number; failed: number }> {
  if (!initFirebase()) return { sent: 0, failed: 0 };

  const devices = await prisma.device.findMany({
    where: { userId, platform: 'ANDROID', enabled: true, pushToken: { not: null } },
    select: { id: true, pushToken: true },
  });
  const targets = withPushToken(devices);
  if (targets.length === 0) return { sent: 0, failed: 0 };

  const message: MulticastMessage = {
    tokens: targets.map((device) => device.pushToken),
    data: {
      type: 'new_message',
      messageId: payload.messageId,
      senderId: payload.senderId,
      senderCallsign: payload.senderCallsign,
      senderDisplayName: payload.senderDisplayName,
      body: payload.body.slice(0, 500),
      groupId: payload.groupId ?? '',
      groupName: payload.groupName ?? '',
      unreadCount: String(Math.max(1, payload.unreadCount)),
    },
    android: {
      priority: 'high',
      ttl: 7 * 24 * 60 * 60 * 1000,
    },
  };

  let response;
  try {
    response = await getMessaging().sendEachForMulticast(message);
  } catch (err) {
    logger.error({ msg: 'Incoming message push failed', userId, messageId: payload.messageId, err });
    return { sent: 0, failed: targets.length };
  }

  const invalidDeviceIds: string[] = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code ?? '';
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      invalidDeviceIds.push(targets[index].id);
    }
  });

  if (invalidDeviceIds.length > 0) {
    await prisma.device.updateMany({
      where: { id: { in: invalidDeviceIds } },
      data: { enabled: false },
    });
  }

  logger.info({
    msg: 'Incoming message push sent',
    userId,
    messageId: payload.messageId,
    sent: response.successCount,
    failed: response.failureCount,
  });

  return { sent: response.successCount, failed: response.failureCount };
}

export interface SensorAlertPush {
  sensorId: string;
  sensorName: string;
  status: 'ALERT' | 'STALE';
  message: string;
}

// Push о тревоге датчика на телефоны участников группы.
// Показывается системным уведомлением (notification), отдельный обработчик
// в Android-приложении не требуется.
export async function sendSensorAlertPushToUsers(
  userIds: string[],
  payload: SensorAlertPush,
): Promise<{ sent: number; failed: number }> {
  if (!initFirebase()) return { sent: 0, failed: 0 };
  if (userIds.length === 0) return { sent: 0, failed: 0 };

  // Все включённые устройства получателей (ANDROID + IOS). Раньше фильтр platform:'ANDROID'
  // вообще исключал iOS, а диспетчер с iPhone не получал тревогу.
  const devices = await prisma.device.findMany({
    // Раньше сюда попадали устройства всех платформ. Токен APNs — не токен
    // FCM, и Firebase отвергает его целой пачкой; ограничиваем Android явно.
    // Тревоги датчиков на iPhone — отдельная задача, обычным push через APNs.
    where: { userId: { in: userIds }, enabled: true, platform: 'ANDROID', pushToken: { not: null } },
    select: { id: true, pushToken: true },
  });
  const targets = withPushToken(devices);
  if (targets.length === 0) return { sent: 0, failed: 0 };

  const message: MulticastMessage = {
    tokens: targets.map((device) => device.pushToken),
    notification: {
      title: `⚠️ ${payload.sensorName}`,
      body: payload.message,
    },
    data: {
      type: 'sensor_alert',
      sensorId: payload.sensorId,
      sensorName: payload.sensorName,
      status: payload.status,
      message: payload.message,
    },
    android: {
      priority: 'high',
      ttl: 60 * 60 * 1000,
    },
  };

  let response;
  try {
    response = await getMessaging().sendEachForMulticast(message);
  } catch (err) {
    logger.error({ msg: 'Sensor alert push failed', sensorId: payload.sensorId, err });
    return { sent: 0, failed: targets.length };
  }

  const invalidDeviceIds: string[] = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code ?? '';
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      invalidDeviceIds.push(targets[index].id);
    }
  });

  if (invalidDeviceIds.length > 0) {
    await prisma.device.updateMany({
      where: { id: { in: invalidDeviceIds } },
      data: { enabled: false },
    });
  }

  logger.info({
    msg: 'Sensor alert push sent',
    sensorId: payload.sensorId,
    sent: response.successCount,
    failed: response.failureCount,
  });

  return { sent: response.successCount, failed: response.failureCount };
}
