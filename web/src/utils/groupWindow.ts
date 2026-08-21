import type { Group } from '@/types';

/**
 * Зеркало server/src/services/groupAccess.ts на клиенте.
 *
 * Сервер — единственный источник истины: он и отказывает. Здесь мы лишь
 * показываем состояние заранее, чтобы человек в поле видел закрытый канал
 * до нажатия PTT, а не упирался в молчаливую стену.
 */

export type GroupClosedReason = 'group_draft' | 'group_archived' | 'group_not_started' | 'group_expired';

export type GroupWindowState =
  | { open: true }
  | { open: false; reason: GroupClosedReason; label: string };

/** Группы, созданные до появления сроков, приходят без полей — они бессрочные. */
export function groupWindowState(group: Pick<Group, 'status' | 'startsAt' | 'endsAt'>, now: Date = new Date()): GroupWindowState {
  if (group.status === 'ARCHIVED') return { open: false, reason: 'group_archived', label: 'ARCHIVED' };
  if (group.status === 'DRAFT') return { open: false, reason: 'group_draft', label: 'DRAFT' };

  if (group.startsAt && now.getTime() < new Date(group.startsAt).getTime()) {
    return { open: false, reason: 'group_not_started', label: 'NOT STARTED' };
  }

  if (group.endsAt && now.getTime() > new Date(group.endsAt).getTime()) {
    return { open: false, reason: 'group_expired', label: 'EXPIRED' };
  }

  return { open: true };
}

export function isGroupOpen(group: Pick<Group, 'status' | 'startsAt' | 'endsAt'>, now: Date = new Date()): boolean {
  return groupWindowState(group, now).open;
}
