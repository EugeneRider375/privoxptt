import { randomBytes, randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import { logger } from '../utils/logger';

export type UserCallStatus = 'ringing' | 'answered' | 'declined' | 'timeout';
export type UserCallKind = 'user' | 'group';

export interface TrackedCall {
  callId: string;
  campaignId: string;
  kind: UserCallKind;
  callerUserId: string;
  callerCallsign: string;
  callerDisplayName?: string;
  targetUserId: string;
  targetCallsign: string;
  groupId: string;
  groupName: string;
  responseToken: string;
  status: UserCallStatus;
  createdAt: number;
  timeout: NodeJS.Timeout;
}

export interface CreateTrackedCallInput {
  campaignId?: string;
  kind: UserCallKind;
  callerUserId: string;
  callerCallsign: string;
  callerDisplayName?: string;
  targetUserId: string;
  targetCallsign: string;
  groupId: string;
  groupName: string;
  /** Вызов провисел все 45с без ответа — повод отправить «пропущенный звонок» (D27). */
  onTimeout?: (call: TrackedCall) => void;
}

const CALL_TIMEOUT_MS = 45_000;
const CALL_RETENTION_MS = 120_000;
const MAX_CALL_DURATION_MS = 4 * 60 * 60 * 1000; // аварийная самоочистка, если hangup не пришёл
const calls = new Map<string, TrackedCall>();

function emitStatus(io: Server, call: TrackedCall): void {
  io.to(`user:${call.callerUserId}`).emit('user-call-status', {
    callId: call.callId,
    campaignId: call.campaignId,
    kind: call.kind,
    targetUserId: call.targetUserId,
    targetCallsign: call.targetCallsign,
    groupId: call.groupId,
    groupName: call.groupName,
    status: call.status,
    createdAt: call.createdAt,
    updatedAt: Date.now(),
  });
}

function scheduleCleanup(callId: string): void {
  setTimeout(() => calls.delete(callId), CALL_RETENTION_MS).unref();
}

export function createTrackedCall(io: Server, input: CreateTrackedCallInput): TrackedCall {
  const callId = randomUUID();
  const call: TrackedCall = {
    callId,
    campaignId: input.campaignId ?? callId,
    kind: input.kind,
    callerUserId: input.callerUserId,
    callerCallsign: input.callerCallsign,
    callerDisplayName: input.callerDisplayName,
    targetUserId: input.targetUserId,
    targetCallsign: input.targetCallsign,
    groupId: input.groupId,
    groupName: input.groupName,
    responseToken: randomBytes(32).toString('hex'),
    status: 'ringing',
    createdAt: Date.now(),
    timeout: setTimeout(() => {
      const current = calls.get(callId);
      if (!current || current.status !== 'ringing') return;
      current.status = 'timeout';
      emitStatus(io, current);
      input.onTimeout?.(current);
      scheduleCleanup(callId);
    }, CALL_TIMEOUT_MS),
  };
  call.timeout.unref();
  calls.set(callId, call);
  emitStatus(io, call);
  return call;
}

function completeCall(io: Server, call: TrackedCall, status: 'answered' | 'declined'): boolean {
  if (call.status !== 'ringing') return false;
  clearTimeout(call.timeout);
  call.status = status;
  emitStatus(io, call);

  // Дуплексный 1:1 звонок: не удаляем запись сразу — она нужна до explicit
  // hangup (endCall), чтобы знать участников для завершения разговора.
  // Аварийная самоочистка на случай, если ни один клиент не пришлёт hangup
  // (краш вкладки и т.п.) — иначе запись висела бы в памяти вечно.
  const isDuplexCall = status === 'answered' && call.kind === 'user';
  if (!isDuplexCall) {
    scheduleCleanup(call.callId);
  } else {
    setTimeout(() => calls.delete(call.callId), MAX_CALL_DURATION_MS).unref();
  }

  if (isDuplexCall) {
    const connectedPayload = { callId: call.callId };
    io.to(`user:${call.callerUserId}`).emit('call-connected', {
      ...connectedPayload,
      otherUserId: call.targetUserId,
      otherCallsign: call.targetCallsign,
    });
    io.to(`user:${call.targetUserId}`).emit('call-connected', {
      ...connectedPayload,
      otherUserId: call.callerUserId,
      otherCallsign: call.callerCallsign,
    });
  }

  logger.info({
    msg: 'User call response',
    callId: call.callId,
    campaignId: call.campaignId,
    targetUserId: call.targetUserId,
    status,
  });
  return true;
}

/** Может ли пользователь присоединиться к аудио-комнате звонка (caller или target активного дуплекс-звонка). */
export function isCallParticipant(callId: string, userId: string): boolean {
  const call = calls.get(callId);
  if (!call) return false;
  return call.status === 'answered' && (call.callerUserId === userId || call.targetUserId === userId);
}

export function endCall(io: Server, callId: string, endedByUserId: string): boolean {
  const call = calls.get(callId);
  if (!call) return false;
  if (call.callerUserId !== endedByUserId && call.targetUserId !== endedByUserId) return false;

  io.to(`user:${call.callerUserId}`).emit('call-ended', { callId, endedByUserId });
  io.to(`user:${call.targetUserId}`).emit('call-ended', { callId, endedByUserId });
  calls.delete(callId);

  logger.info({ msg: 'Call ended', callId, endedByUserId });
  return true;
}

export function respondToCallWithToken(
  io: Server,
  callId: string,
  responseToken: string,
  status: 'answered' | 'declined',
): boolean {
  const call = calls.get(callId);
  if (!call || call.responseToken !== responseToken) return false;
  return completeCall(io, call, status);
}

export function respondToCallAsUser(
  io: Server,
  callId: string,
  targetUserId: string,
  status: 'answered' | 'declined',
): boolean {
  const call = calls.get(callId);
  if (!call || call.targetUserId !== targetUserId) return false;
  return completeCall(io, call, status);
}
