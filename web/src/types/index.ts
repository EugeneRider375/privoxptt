export type UserRole = 'SUPERADMIN' | 'ADMIN' | 'DISPATCHER' | 'USER';

export interface User {
  id: string;
  email: string;
  callsign: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  isOnline?: boolean;
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
  organizationId: string;
  pttOwnerId?: string | null;
  members?: GroupMember[];
  _count?: { members: number };
}

export interface GroupMember {
  id: string;
  userId: string;
  groupId: string;
  canSpeak: boolean;
  isOnline?: boolean;
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

export interface Alert {
  id: string;
  type: 'sos' | 'info' | 'warn' | 'error';
  userId?: string;
  callsign?: string;
  message: string;
  timestamp: number;
  read: boolean;
}
