import { GroupStatus, Prisma } from '@prisma/client';

import { AppError } from '../middleware/errorHandler';

/**
 * Срок действия группы и права участника внутри неё.
 *
 * Поля `Group.startsAt/endsAt/status` и `GroupMember.canMessage/canShareLocation`
 * заполнялись мастером создания группы, но ни на что не влияли. Здесь собрана
 * общая логика, чтобы сокет и REST судили по одному правилу, а не по двум
 * разъехавшимся копиям.
 *
 * Правило окна одно для всех ролей, включая SUPERADMIN: просроченная группа —
 * это закрытый канал, а не канал с исключениями. Администратор чинит её,
 * продлевая срок (PUT /api/groups/:id), а не разговаривая в ней.
 *
 * При этом окно глушит только НАЧАЛО нового трафика (вход в группу, PTT,
 * звонок, отправка сообщения). Уже начатое доигрывает: ptt-stop, leave-group,
 * call-hangup и ответ на звонок проверок не имеют — иначе истечение срока
 * посреди эфира оставило бы висеть незакрытые локи и комнаты.
 */

export type GroupWindow = {
  status: GroupStatus;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type GroupClosedReason =
  | 'group_draft'
  | 'group_archived'
  | 'group_not_started'
  | 'group_expired';

export type GroupWindowCheck =
  | { open: true }
  | { open: false; reason: GroupClosedReason; message: string };

/** Поля, которые надо вытащить из БД, чтобы проверить окно. */
export const GROUP_WINDOW_SELECT = {
  status: true,
  startsAt: true,
  endsAt: true,
} as const satisfies Prisma.GroupSelect;

/**
 * Открыта ли группа для связи прямо сейчас.
 * Границы включительные: ровно в startsAt группа уже открыта, ровно в endsAt ещё открыта.
 */
export function checkGroupWindow(group: GroupWindow, now: Date = new Date()): GroupWindowCheck {
  if (group.status === GroupStatus.ARCHIVED) {
    return {
      open: false,
      reason: 'group_archived',
      message: 'This group is archived',
    };
  }

  if (group.status === GroupStatus.DRAFT) {
    return {
      open: false,
      reason: 'group_draft',
      message: 'This group is not activated yet',
    };
  }

  if (group.startsAt && now.getTime() < group.startsAt.getTime()) {
    return {
      open: false,
      reason: 'group_not_started',
      message: `This group opens on ${group.startsAt.toISOString()}`,
    };
  }

  if (group.endsAt && now.getTime() > group.endsAt.getTime()) {
    return {
      open: false,
      reason: 'group_expired',
      message: `This group expired on ${group.endsAt.toISOString()}`,
    };
  }

  return { open: true };
}

/**
 * Фрагмент WHERE для «группа открыта прямо сейчас».
 * Держится в одном файле с checkGroupWindow, чтобы БД и код не разошлись.
 */
export function openGroupFilter(now: Date = new Date()): Prisma.GroupWhereInput {
  return {
    status: GroupStatus.ACTIVE,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
}

/** Конец срока не может быть раньше начала (или совпадать с ним). */
export function assertPeriodOrder(startsAt: Date | null, endsAt: Date | null): void {
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new AppError(400, 'End date must be later than the start date');
  }
}
