import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { config } from '../config';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';

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

export async function hasReachablePushDevice(userId: string): Promise<boolean> {
  const count = await prisma.device.count({
    where: { userId, enabled: true },
  });
  return count > 0;
}

export async function sendIncomingUserCallPush(
  userId: string,
  payload: IncomingUserCallPush,
): Promise<{ sent: number; failed: number }> {
  if (!initFirebase()) return { sent: 0, failed: 0 };

  const devices = await prisma.device.findMany({
    where: { userId, platform: 'ANDROID', enabled: true },
    select: { id: true, pushToken: true },
  });
  if (devices.length === 0) return { sent: 0, failed: 0 };

  const responseBaseUrl = (config.SERVICE_URL_WEB ?? config.corsOrigins[0]).replace(/\/+$/, '');
  const message: MulticastMessage = {
    tokens: devices.map((device) => device.pushToken),
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
    return { sent: 0, failed: devices.length };
  }

  const invalidDeviceIds: string[] = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code ?? '';
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      invalidDeviceIds.push(devices[index].id);
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
