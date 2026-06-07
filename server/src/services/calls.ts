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
  targetUserId: string;
  targetCallsign: string;
  groupId: string;
  groupName: string;
}

const CALL_TIMEOUT_MS = 45_000;
const CALL_RETENTION_MS = 120_000;
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
  scheduleCleanup(call.callId);
  logger.info({
    msg: 'User call response',
    callId: call.callId,
    campaignId: call.campaignId,
    targetUserId: call.targetUserId,
    status,
  });
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
