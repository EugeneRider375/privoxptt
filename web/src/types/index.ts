export type UserRole = 'SUPERADMIN' | 'ADMIN' | 'DISPATCHER' | 'USER';
export type ActivityLogType = 'USER_ONLINE' | 'USER_OFFLINE';

export type GroupStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface User {
  id: string;
  /** Может отсутствовать: массово созданные участники входят по login. */
  email: string | null;
  login?: string | null;
  callsign: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  isOnline?: boolean;
  isReachable?: boolean;
  lastSeen?: string;
  organizationId: string;
  organization?: Organization;
  groupMembers?: GroupMembership[];
  location?: UserLocation;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  color: string;
  priority: number;
  isPrivate: boolean;
  /** Появилось вместе с вопросником; у групп, созданных раньше, — ACTIVE. */
  status?: GroupStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  archivedAt?: string | null;
  organizationId: string;
  pttOwnerId?: string | null;
  members?: GroupMember[];
  organization?: Pick<Organization, 'name' | 'slug'>;
  _count?: { members: number };
}

export interface GroupMember {
  id: string;
  userId: string;
  groupId: string;
  canSpeak: boolean;
  isOnline?: boolean;
  isReachable?: boolean;
  user: Pick<User, 'id' | 'callsign' | 'displayName' | 'role'>;
}

export interface GroupMembership {
  canSpeak: boolean;
  group: Pick<Group, 'id' | 'name' | 'color' | 'priority'>;
}

export interface UserLocation {
  userId: string;
  callsign: string;
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
}

// Socket.io события
export interface ChannelBusyEvent {
  groupId: string;
  userId: string;
  callsign: string;
  displayName: string;
}

export interface ChannelFreeEvent {
  groupId: string;
}

export interface ChannelLockedEvent {
  groupId: string;
  lockedBy?: string;
  lockedByCallsign?: string;
  reason: 'channel_busy' | 'no_speak_permission';
  message: string;
}

export interface UserOnlineEvent {
  userId: string;
  callsign: string;
  displayName: string;
}

export interface IncomingCallEvent {
  fromId: string;
  fromCallsign: string;
  fromDisplayName: string;
}

export type DispatcherCallStatus = 'pending' | 'answered' | 'cancelled' | 'missed' | 'expired';
export type DispatcherCallPriority = 'normal' | 'urgent' | 'sos';

export interface DispatcherCall {
  callId: string;
  groupId: string;
  groupName: string;
  fromUserId: string;
  callsign: string;
  displayName: string;
  message: string;
  priority: DispatcherCallPriority;
  status: DispatcherCallStatus;
  createdAt: number;
  dispatcherId?: string;
  dispatcherCallsign?: string;
  answeredAt?: number;
}

export type PttStatus = 'idle' | 'transmitting' | 'receiving' | 'locked';

export type UserCallStatus = 'ringing' | 'answered' | 'declined' | 'timeout';
export type UserCallKind = 'user' | 'group';

export interface UserCallStatusEvent {
  callId: string;
  campaignId: string;
  kind: UserCallKind;
  targetUserId: string;
  targetCallsign: string;
  groupId: string;
  groupName: string;
  status: UserCallStatus;
  createdAt: number;
  updatedAt: number;
}

export type SensorSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface SensorRule {
  id: string;
  metric: string;
  op: 'gt' | 'lt' | 'outside' | 'is';
  value?: number | boolean;
  min?: number;
  max?: number;
  severity?: SensorSeverity;
  sustainedSec?: number;
}

export interface Sensor {
  id: string;
  organizationId: string;
  name: string;
  kind: 'FRIDGE' | 'OUTDOOR' | 'INDOOR';
  ingest: 'PULL' | 'PUSH';
  adapter: 'FRIGO' | 'HOMECLIMATE' | null;
  sourceUrl: string | null;
  externalId: string | null;
  sensorKey: string | null;
  // массив правил (новый) ИЛИ старый объект { metric: {min,max} }
  thresholds: SensorRule[] | Record<string, { min?: number; max?: number }>;
  reportIntervalSec: number | null;
  batteryPct: number | null;
  rssi: number | null;
  lat: number | null;
  lng: number | null;
  groupId: string | null;
  group?: { id: string; name: string } | null;
  organization?: { name: string; slug: string };
  lastValue: Record<string, number | boolean> | null;
  lastSeenAt: string | null;
  status: 'OK' | 'ALERT' | 'STALE';
  enabled: boolean;
  alarmSound: boolean; // играть ли звуковую сирену диспетчеру при тревоге
  createdAt: string;
  updatedAt: string;
}

export interface SensorState {
  id: string;
  name: string;
  kind: 'FRIDGE' | 'OUTDOOR' | 'INDOOR';
  status: 'OK' | 'ALERT' | 'STALE';
  armed?: boolean; // на охране; false = тревоги подавлены (телеметрия видна живьём)
  metrics?: Record<string, number | boolean>;
  temperature: number | null;
  humidity: number | null;
  lat?: number | null;
  lng?: number | null;
  lastSeenAt: string | null;
}

export interface Alert {
  id: string;
  type: 'sos' | 'info' | 'warn' | 'error' | 'sensor';
  variant?: 'toast' | 'user-call' | 'message';
  userId?: string;
  callsign?: string;
  message: string;
  groupName?: string;
  groupId?: string;
  callId?: string;
  callKind?: UserCallKind;
  timestamp: number;
  read: boolean;
}

export interface ActivityLogEntry {
  id: string;
  type: ActivityLogType;
  userId?: string | null;
  callsign: string;
  displayName: string;
  createdAt: string;
  organization?: Pick<Organization, 'name' | 'slug'>;
}

export interface ChatMessage {
  id: string;
  organizationId: string;
  senderId: string;
  recipientId: string | null;
  groupId: string | null;
  body: string;
  attachment: {
    name: string;
    type: string;
    size: number;
  } | null;
  createdAt: string;
  readCount: number;
  sender: Pick<User, 'id' | 'callsign' | 'displayName' | 'role'>;
}

export interface ChatConversation {
  type: 'group' | 'direct';
  id: string;
  title: string;
  subtitle?: string;
  color?: string;
  role?: UserRole;
  unreadCount: number;
  lastMessage: ChatMessage | null;
}

// ─── Вопросник суперадмина ──────────────────────────────────

export interface WizardPermissions {
  role: UserRole;
  canSpeak: boolean;
  canMessage: boolean;
  canShareLocation: boolean;
  isGroupAdmin: boolean;
}

export interface PreviewRow {
  callsign: string;
  status: 'NEW' | 'EXISTING' | 'REJECTED';
  /** Предлагаемый логин — только для NEW. */
  login?: string;
  error?: string;
  existing?: {
    userId: string;
    callsign: string;
    displayName: string;
    login: string | null;
    email: string | null;
    role: UserRole;
    isActive: boolean;
  };
  defaultAction: 'create' | 'use_existing' | 'skip';
}

export interface WizardPreview {
  organization: Pick<Organization, 'id' | 'name' | 'slug'>;
  group: { name: string; status: GroupStatus; unlimited: boolean; endsAt?: string | null };
  totals: { total: number; toCreate: number; existing: number; rejected: number; invites: number };
  rows: PreviewRow[];
  warnings: string[];
}

export interface CreatedMember {
  userId: string;
  callsign: string;
  displayName: string;
  login: string | null;
  isNew: boolean;
  /** Показывается ОДИН раз — в базе только хеш. */
  tempPassword: string | null;
  inviteId: string;
  inviteUrl: string;
}

export interface WizardResult {
  group: Group & { unlimited: boolean };
  organization: Pick<Organization, 'id' | 'name' | 'slug'>;
  members: CreatedMember[];
  invites: { expiresAt: string; singleUse: boolean; count: number };
  sharedPassword: string | null;
}

export type InviteStatus = 'CREATED' | 'OPENED' | 'ACTIVATED' | 'EXPIRED' | 'REVOKED';

export interface GroupInvite {
  id: string;
  status: InviteStatus;
  user: { id: string; callsign: string; displayName: string; login: string | null; isActive: boolean };
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  singleUse: boolean;
  firstOpenedAt: string | null;
  activatedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdByLabel: string | null;
}

export interface GroupInvitesResponse {
  group: { id: string; name: string };
  invites: GroupInvite[];
  membersWithoutInvite: GroupInvite['user'][];
}
