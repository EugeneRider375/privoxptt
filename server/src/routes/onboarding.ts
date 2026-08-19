import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { GroupStatus, InviteStatus, Prisma, UserRole } from '@prisma/client';

import { prisma } from '../database/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config';
import { logger } from '../utils/logger';
import { emitOrgDataChanged } from '../utils/realtime';
import { assignLogins, normalizeLogin, parseCallsignList, validateCallsign } from '../utils/login';
import {
  buildInviteUrl,
  checkSharedPassword,
  generateInviteToken,
  generateTempPassword,
  hashInviteToken,
} from '../utils/credentials';

/**
 * Вопросник суперадмина: создание группы вместе с участниками, учётными
 * данными и персональными приглашениями.
 *
 * Смонтирован отдельным путём (/api/onboarding), а не внутри /api/groups —
 * там уже живёт работающий роутер с маршрутом /:id, и новый подпуть пришлось
 * бы проводить мимо него по порядку регистрации. Существующие эндпоинты групп и
 * пользователей не меняются: этот модуль только читает их данные и создаёт
 * записи теми же моделями.
 */
export const onboardingRouter = Router();

onboardingRouter.use(authenticate);
onboardingRouter.use(requireAdmin);

/** Предохранитель: одна операция создаёт не больше стольких участников. */
const MAX_MEMBERS = 200;

/** Сколько живёт приглашение по умолчанию. */
const DEFAULT_INVITE_DAYS = 14;

const BCRYPT_ROUNDS = 12;

// ─── Схемы ввода ────────────────────────────────────────────

const groupInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  /** null или отсутствует = начинается сразу. */
  startsAt: z.string().datetime().nullish(),
  /** null или отсутствует = «Без ограничения»: группа живёт, пока её не архивируют. */
  endsAt: z.string().datetime().nullish(),
  /** false = создать в статусе DRAFT и включить позже. */
  activateNow: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(0),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3DDC84'),
  isPrivate: z.boolean().default(false),
});

const permissionsSchema = z.object({
  role: z.nativeEnum(UserRole).default(UserRole.USER),
  canSpeak: z.boolean().default(true),
  canMessage: z.boolean().default(true),
  canShareLocation: z.boolean().default(true),
  isGroupAdmin: z.boolean().default(false),
});

const previewSchema = z.object({
  organizationId: z.string().uuid().optional(),
  group: groupInputSchema,
  membersText: z.string().default(''),
  defaults: permissionsSchema.partial().default({}),
});

const memberActionSchema = z.enum(['create', 'use_existing', 'skip']);

const createSchema = z.object({
  organizationId: z.string().uuid().optional(),
  group: groupInputSchema,
  members: z
    .array(
      permissionsSchema.partial().extend({
        callsign: z.string().trim().min(1),
        action: memberActionSchema,
        /** Для use_existing — какого именно пользователя берём. */
        userId: z.string().uuid().optional(),
        /** Для create — логин, если администратор поправил предложенный. */
        login: z.string().trim().optional(),
        displayName: z.string().trim().max(100).optional(),
      })
    )
    .max(MAX_MEMBERS, `At most ${MAX_MEMBERS} members can be added in one operation`),
  invites: z
    .object({
      expiresInDays: z.number().int().min(1).max(365).default(DEFAULT_INVITE_DAYS),
      /**
       * По умолчанию приглашение действует до истечения срока, а не один раз.
       * Причина практическая: человек открывает ссылку в браузере, потом
       * ставит приложение — у него своё хранилище, сессия туда не переезжает,
       * и ссылка нужна второй раз. Одноразовость остаётся опцией.
       */
      singleUse: z.boolean().default(false),
    })
    .default({ expiresInDays: DEFAULT_INVITE_DAYS, singleUse: false }),
  password: z
    .object({
      /** individual — каждому свой (по умолчанию). shared — общий на всех. */
      mode: z.enum(['individual', 'shared']).default('individual'),
      sharedPassword: z.string().optional(),
      /** Осознанное подтверждение риска общего пароля. */
      acknowledgeSharedRisk: z.boolean().default(false),
    })
    .default({ mode: 'individual', acknowledgeSharedRisk: false }),
});

// ─── Вспомогательное ────────────────────────────────────────

function resolveOrgId(req: Request, requested?: string): string {
  if (req.user!.role === UserRole.SUPERADMIN && requested) return requested;
  if (requested && requested !== req.user!.organizationId) {
    throw new AppError(403, 'Cannot create groups in another organization');
  }
  return req.user!.organizationId;
}

/** Даты: конец не может быть раньше начала. */
function validatePeriod(startsAt?: string | null, endsAt?: string | null): void {
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new AppError(400, 'End date must be later than the start date');
  }
}

interface OrgSnapshot {
  /** Позывной в нижнем регистре → существующий пользователь этой организации. */
  byCallsign: Map<string, {
    id: string;
    callsign: string;
    displayName: string;
    login: string | null;
    email: string | null;
    role: UserRole;
    isActive: boolean;
  }>;
  /** Все занятые логины — уникальность логина глобальная, не по организации. */
  takenLogins: string[];
}

async function loadOrgSnapshot(organizationId: string): Promise<OrgSnapshot> {
  const [orgUsers, loginRows] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true, callsign: true, displayName: true, login: true,
        email: true, role: true, isActive: true,
      },
    }),
    // Логин уникален во всей базе, поэтому занятые собираем без фильтра по организации.
    prisma.user.findMany({
      where: { login: { not: null } },
      select: { login: true },
    }),
  ]);

  const byCallsign = new Map<string, OrgSnapshot['byCallsign'] extends Map<string, infer V> ? V : never>();
  for (const u of orgUsers) {
    // При дублях позывного (в проде такие есть) берём первого — администратор
    // увидит конфликт в предпросмотре и решит сам.
    const key = u.callsign.trim().toLowerCase();
    if (!byCallsign.has(key)) byCallsign.set(key, u);
  }

  return {
    byCallsign,
    takenLogins: loginRows.map((r) => r.login!).filter(Boolean),
  };
}

type RowStatus = 'NEW' | 'EXISTING' | 'REJECTED';

interface PreviewRow {
  callsign: string;
  status: RowStatus;
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
    alreadyInGroup?: boolean;
  };
  /** Что произойдёт, если администратор ничего не менял. */
  defaultAction: 'create' | 'use_existing' | 'skip';
}

/**
 * Ядро предпросмотра: список позывных → что будет создано.
 * Ничего не пишет в базу.
 *
 * `groupMemberIds` передаётся при пополнении существующей группы: тех, кто уже
 * в ней состоит, надо показать отдельно и по умолчанию пропустить — повторное
 * добавление нарушило бы уникальность (userId, groupId) и откатило бы всю
 * операцию целиком.
 */
function buildPreviewRows(
  membersText: string,
  snapshot: OrgSnapshot,
  groupMemberIds?: ReadonlySet<string>
) {
  const { callsigns, duplicates } = parseCallsignList(membersText);

  const rows: PreviewRow[] = [];
  const takenLogins = [...snapshot.takenLogins];

  for (const callsign of callsigns) {
    const check = validateCallsign(callsign);
    if (!check.ok) {
      rows.push({ callsign, status: 'REJECTED', error: check.error, defaultAction: 'skip' });
      continue;
    }

    const existing = snapshot.byCallsign.get(callsign.trim().toLowerCase());
    if (existing) {
      const alreadyInGroup = groupMemberIds?.has(existing.id) ?? false;
      rows.push({
        callsign: callsign.trim(),
        status: 'EXISTING',
        existing: {
          userId: existing.id,
          callsign: existing.callsign,
          displayName: existing.displayName,
          login: existing.login,
          email: existing.email,
          role: existing.role,
          isActive: existing.isActive,
          alreadyInGroup,
        },
        // По умолчанию НЕ плодим дубли: берём существующего пользователя.
        // А кто уже в группе — пропускается, добавлять его второй раз нечем.
        defaultAction: alreadyInGroup ? 'skip' : 'use_existing',
      });
      continue;
    }

    const { assigned } = assignLogins([callsign], takenLogins);
    const login = assigned[0]!.login;
    takenLogins.push(login);

    rows.push({ callsign: callsign.trim(), status: 'NEW', login, defaultAction: 'create' });
  }

  return { rows, duplicates };
}

// ─── POST /api/onboarding/preview ───────────────────────────
// Показывает, что будет создано. Не создаёт ничего.

onboardingRouter.post('/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = previewSchema.parse(req.body);
    const organizationId = resolveOrgId(req, data.organizationId);
    validatePeriod(data.group.startsAt, data.group.endsAt);

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });
    if (!organization) throw new AppError(404, 'Organization not found');

    const snapshot = await loadOrgSnapshot(organizationId);
    const { rows, duplicates } = buildPreviewRows(data.membersText, snapshot);

    const warnings: string[] = [];
    if (duplicates.length) {
      warnings.push(`Duplicates in the list were skipped: ${duplicates.join(', ')}`);
    }
    if (rows.length > MAX_MEMBERS) {
      warnings.push(`At most ${MAX_MEMBERS} members are created in one operation`);
    }
    const sameName = await prisma.group.findFirst({
      where: { organizationId, name: data.group.name },
      select: { id: true },
    });
    if (sameName) {
      warnings.push(`A group named "${data.group.name}" already exists in this organization`);
    }

    const toCreate = rows.filter((r) => r.status === 'NEW').length;
    const existing = rows.filter((r) => r.status === 'EXISTING').length;
    const rejected = rows.filter((r) => r.status === 'REJECTED').length;

    res.json({
      organization,
      group: {
        ...data.group,
        status: data.group.activateNow ? GroupStatus.ACTIVE : GroupStatus.DRAFT,
        unlimited: !data.group.endsAt,
      },
      totals: {
        total: rows.length,
        toCreate,
        existing,
        rejected,
        // Столько персональных QR будет выпущено: всем, кроме отклонённых.
        invites: toCreate + existing,
      },
      rows,
      warnings,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Общая часть: подготовка и вставка участников ───────────
// Ею пользуются оба сценария — создание новой группы и добавление людей
// в уже работающую. Логика одна, различается только откуда берётся группа.

interface Prepared {
  action: 'create' | 'use_existing';
  callsign: string;
  displayName: string;
  login?: string;
  userId?: string;
  passwordHash?: string;
  /** Показывается администратору один раз и нигде не сохраняется. */
  plainPassword?: string;
  role: UserRole;
  canSpeak: boolean;
  canMessage: boolean;
  canShareLocation: boolean;
  isGroupAdmin: boolean;
  inviteToken: string;
}

type MemberInput = z.infer<typeof createSchema>['members'][number];
type PasswordInput = z.infer<typeof createSchema>['password'];

/** Общий пароль разрешён только с явным признанием риска. */
function resolveSharedPassword(password: PasswordInput): string | null {
  if (password.mode !== 'shared') return null;

  if (!password.acknowledgeSharedRisk) {
    throw new AppError(
      400,
      'A password shared by all members is a risk: any of them can sign in as another. ' +
        'Confirm that you accept this risk to continue.'
    );
  }

  const value = password.sharedPassword?.trim() || generateTempPassword();
  const quality = checkSharedPassword(value);
  if (!quality.ok) throw new AppError(400, quality.error!);
  return value;
}

/**
 * Всё тяжёлое считается ДО открытия транзакции: bcrypt при 12 раундах занимает
 * ~250 мс на пароль, и держать транзакцию открытой всё это время — значит
 * блокировать таблицы на десятки секунд.
 */
async function prepareMembers(opts: {
  actorRole: UserRole;
  organizationId: string;
  members: MemberInput[];
  sharedPassword: string | null;
  takenLogins: Set<string>;
}): Promise<Prepared[]> {
  const { actorRole, organizationId, members, sharedPassword, takenLogins } = opts;

  // Проход 1: проверки без обращений к базе.
  const toCreate: (Prepared & { action: 'create' })[] = [];
  const toReuse: {
    userId: string;
    callsign: string;
    perms: Omit<Prepared, 'action' | 'callsign' | 'displayName'>;
  }[] = [];

  for (const m of members) {
    const role = m.role ?? UserRole.USER;

    if (role === UserRole.SUPERADMIN && actorRole !== UserRole.SUPERADMIN) {
      throw new AppError(403, 'Cannot grant the superadmin role');
    }

    const perms = {
      role,
      canSpeak: m.canSpeak ?? true,
      canMessage: m.canMessage ?? true,
      canShareLocation: m.canShareLocation ?? true,
      isGroupAdmin: m.isGroupAdmin ?? false,
      inviteToken: generateInviteToken(),
    };

    if (m.action === 'use_existing') {
      if (!m.userId) throw new AppError(400, `No existing user specified for "${m.callsign}"`);
      toReuse.push({ userId: m.userId, callsign: m.callsign, perms });
      continue;
    }

    const check = validateCallsign(m.callsign);
    if (!check.ok) throw new AppError(400, check.error!);

    const requested = m.login ? normalizeLogin(m.login) : normalizeLogin(m.callsign);
    if (!requested) throw new AppError(400, `Cannot derive a login for "${m.callsign}"`);
    if (takenLogins.has(requested)) {
      throw new AppError(409, `Login "${requested}" is already taken — go back to preview`);
    }
    takenLogins.add(requested);

    toCreate.push({
      ...perms,
      action: 'create',
      callsign: m.callsign.trim().toUpperCase(),
      displayName: m.displayName?.trim() || m.callsign.trim(),
      login: requested,
      plainPassword: sharedPassword ?? generateTempPassword(),
    });
  }

  // Проход 2: существующие пользователи — ОДИН запрос вместо запроса на каждого.
  const reusedById = new Map<string, { id: string; callsign: string; displayName: string }>();
  if (toReuse.length) {
    const found = await prisma.user.findMany({
      where: { id: { in: toReuse.map((r) => r.userId) } },
      select: { id: true, callsign: true, displayName: true, organizationId: true },
    });
    for (const u of found) {
      if (u.organizationId !== organizationId) {
        throw new AppError(400, `"${u.callsign}" belongs to another organization`);
      }
      reusedById.set(u.id, u);
    }
    for (const r of toReuse) {
      if (!reusedById.has(r.userId)) {
        throw new AppError(404, `User for "${r.callsign}" not found`);
      }
    }
  }

  // Проход 3: пароли считаются ПАРАЛЛЕЛЬНО. Последовательный цикл здесь
  // упирался в 13 с на 50 участников — больше, чем таймаут веб-клиента.
  const hashes = await Promise.all(
    toCreate.map((c) => bcrypt.hash(c.plainPassword!, BCRYPT_ROUNDS))
  );
  toCreate.forEach((c, i) => {
    c.passwordHash = hashes[i];
  });

  // Порядок сохраняем как во входном списке: сначала созданные, затем взятые.
  return [
    ...toCreate,
    ...toReuse.map((r) => {
      const u = reusedById.get(r.userId)!;
      return {
        ...r.perms,
        action: 'use_existing' as const,
        userId: u.id,
        callsign: u.callsign,
        displayName: u.displayName,
      };
    }),
  ];
}

interface CreatedMember {
  userId: string;
  callsign: string;
  displayName: string;
  login: string | null;
  isNew: boolean;
  tempPassword?: string;
  inviteId: string;
  inviteToken: string;
}

/** Создание пользователей, участия в группе и приглашений. Только внутри транзакции. */
async function insertMembers(
  tx: Prisma.TransactionClient,
  opts: {
    groupId: string;
    organizationId: string;
    prepared: Prepared[];
    inviteExpiresAt: Date;
    singleUse: boolean;
    actorId: string | null;
    actorLabel: string;
  }
): Promise<CreatedMember[]> {
  const created: CreatedMember[] = [];

  for (const p of opts.prepared) {
    let userId = p.userId!;

    if (p.action === 'create') {
      const user = await tx.user.create({
        data: {
          callsign: p.callsign,
          displayName: p.displayName,
          login: p.login!,
          password: p.passwordHash!,
          role: p.role,
          organizationId: opts.organizationId,
          mustChangePassword: true,
        },
        select: { id: true },
      });
      userId = user.id;
    }

    await tx.groupMember.create({
      data: {
        groupId: opts.groupId,
        userId,
        canSpeak: p.canSpeak,
        canMessage: p.canMessage,
        canShareLocation: p.canShareLocation,
        isGroupAdmin: p.isGroupAdmin,
      },
    });

    const invite = await tx.invite.create({
      data: {
        tokenHash: hashInviteToken(p.inviteToken),
        userId,
        groupId: opts.groupId,
        organizationId: opts.organizationId,
        expiresAt: opts.inviteExpiresAt,
        maxUses: opts.singleUse ? 1 : 0, // 0 = без ограничения по числу
        createdById: opts.actorId,
        createdByLabel: opts.actorLabel,
      },
      select: { id: true },
    });

    created.push({
      userId,
      callsign: p.callsign,
      displayName: p.displayName,
      login: p.login ?? null,
      isNew: p.action === 'create',
      tempPassword: p.plainPassword,
      inviteId: invite.id,
      inviteToken: p.inviteToken,
    });
  }

  return created;
}

/** Ответ администратору. Пароли и токены здесь видны в ПЕРВЫЙ и последний раз. */
function serializeCreated(created: CreatedMember[]) {
  return created.map((c) => ({
    userId: c.userId,
    callsign: c.callsign,
    displayName: c.displayName,
    login: c.login,
    isNew: c.isNew,
    tempPassword: c.tempPassword ?? null,
    inviteId: c.inviteId,
    inviteUrl: buildInviteUrl(config.publicWebUrl, c.inviteToken),
  }));
}

async function loadActor(userId: string) {
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, callsign: true, login: true, email: true },
  });
  return {
    id: actor?.id ?? null,
    label: actor?.callsign || actor?.login || actor?.email || 'unknown',
  };
}

/** Группа существует, доступна этому администратору и пригодна для пополнения. */
async function loadWritableGroup(req: Request, groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      members: { select: { userId: true } },
    },
  });
  if (!group) throw new AppError(404, 'Group not found');

  if (
    req.user!.role !== UserRole.SUPERADMIN &&
    group.organizationId !== req.user!.organizationId
  ) {
    throw new AppError(403, 'Access denied');
  }

  if (group.status === GroupStatus.ARCHIVED) {
    throw new AppError(400, 'This group is archived — restore it before adding members');
  }

  return group;
}

// ─── POST /api/onboarding/create ────────────────────────────
// Создаёт группу, пользователей, участников и приглашения ОДНОЙ транзакцией.

onboardingRouter.post('/create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createSchema.parse(req.body);
    const organizationId = resolveOrgId(req, data.organizationId);
    validatePeriod(data.group.startsAt, data.group.endsAt);

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });
    if (!organization) throw new AppError(404, 'Organization not found');

    const actor = await loadActor(req.user!.userId);
    const sharedPassword = resolveSharedPassword(data.password);

    const wanted = data.members.filter((m) => m.action !== 'skip');
    if (wanted.length === 0) throw new AppError(400, 'The group has no members');

    const snapshot = await loadOrgSnapshot(organizationId);
    const prepared = await prepareMembers({
      actorRole: req.user!.role,
      organizationId,
      members: wanted,
      sharedPassword,
      takenLogins: new Set(snapshot.takenLogins.map((l) => l.toLowerCase())),
    });

    const inviteExpiresAt = new Date(Date.now() + data.invites.expiresInDays * 86_400_000);

    const result = await prisma.$transaction(
      async (tx) => {
        const group = await tx.group.create({
          data: {
            name: data.group.name,
            description: data.group.description,
            organizationId,
            isPrivate: data.group.isPrivate,
            priority: data.group.priority,
            color: data.group.color,
            startsAt: data.group.startsAt ? new Date(data.group.startsAt) : null,
            endsAt: data.group.endsAt ? new Date(data.group.endsAt) : null,
            status: data.group.activateNow ? GroupStatus.ACTIVE : GroupStatus.DRAFT,
          },
        });

        const created = await insertMembers(tx, {
          groupId: group.id,
          organizationId,
          prepared,
          inviteExpiresAt,
          singleUse: data.invites.singleUse,
          actorId: actor.id,
          actorLabel: actor.label,
        });

        await tx.adminAuditLog.create({
          data: {
            organizationId,
            actorId: actor.id,
            actorLabel: actor.label,
            action: 'group.create_with_members',
            targetType: 'group',
            targetId: group.id,
            // Пароли и токены сюда НЕ попадают — только счётчики и имена.
            meta: {
              groupName: group.name,
              status: group.status,
              endsAt: group.endsAt,
              membersTotal: created.length,
              membersCreated: created.filter((c) => c.isNew).length,
              membersExisting: created.filter((c) => !c.isNew).length,
              invitesIssued: created.length,
              inviteExpiresAt: inviteExpiresAt.toISOString(),
              sharedPassword: data.password.mode === 'shared',
            } as Prisma.InputJsonValue,
            ip: req.ip ?? null,
          },
        });

        return { group, created };
      },
      // Массовое создание с bcrypt уже посчитанным заранее укладывается быстро,
      // но при 200 участниках запас нужен.
      { timeout: 60_000, maxWait: 10_000 }
    );

    emitOrgDataChanged(req, organizationId, 'groups', { groupId: result.group.id, action: 'created' });
    emitOrgDataChanged(req, organizationId, 'users', { action: 'created' });

    logger.info({
      msg: 'Группа создана через вопросник',
      groupId: result.group.id,
      groupName: result.group.name,
      organizationId,
      members: result.created.length,
      // Ни паролей, ни токенов в журнале.
    });

    res.status(201).json({
      group: {
        id: result.group.id,
        name: result.group.name,
        description: result.group.description,
        status: result.group.status,
        startsAt: result.group.startsAt,
        endsAt: result.group.endsAt,
        unlimited: !result.group.endsAt,
        color: result.group.color,
        priority: result.group.priority,
      },
      organization,
      members: serializeCreated(result.created),
      invites: {
        expiresAt: inviteExpiresAt,
        singleUse: data.invites.singleUse,
        count: result.created.length,
      },
      sharedPassword,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/onboarding/groups/:groupId/preview ────────────
// Пополнение УЖЕ работающей группы: «бригада в деле, пришёл новый человек».
// Ничего не создаёт.

onboardingRouter.post('/groups/:groupId/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = z.string().uuid().parse(req.params.groupId);
    const { membersText } = z.object({ membersText: z.string().default('') }).parse(req.body);

    const group = await loadWritableGroup(req, groupId);
    const snapshot = await loadOrgSnapshot(group.organizationId);
    const memberIds = new Set(group.members.map((m) => m.userId));

    const { rows, duplicates } = buildPreviewRows(membersText, snapshot, memberIds);

    const warnings: string[] = [];
    if (duplicates.length) {
      warnings.push(`Duplicates in the list were skipped: ${duplicates.join(', ')}`);
    }
    const alreadyIn = rows.filter((r) => r.existing?.alreadyInGroup).length;
    if (alreadyIn) {
      warnings.push(`${alreadyIn} of them are already in this group and will be skipped`);
    }

    res.json({
      organization: group.organization,
      group: {
        id: group.id,
        name: group.name,
        status: group.status,
        endsAt: group.endsAt,
        unlimited: !group.endsAt,
        currentMembers: group.members.length,
      },
      totals: {
        total: rows.length,
        toCreate: rows.filter((r) => r.status === 'NEW').length,
        existing: rows.filter((r) => r.status === 'EXISTING' && !r.existing?.alreadyInGroup).length,
        alreadyInGroup: alreadyIn,
        rejected: rows.filter((r) => r.status === 'REJECTED').length,
        invites: rows.filter((r) => r.defaultAction !== 'skip').length,
      },
      rows,
      warnings,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/onboarding/groups/:groupId/add ────────────────
// Добавляет людей в существующую группу и выдаёт им приглашения. Одна транзакция.

const addToGroupSchema = createSchema.omit({ group: true, organizationId: true });

onboardingRouter.post('/groups/:groupId/add', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = z.string().uuid().parse(req.params.groupId);
    const data = addToGroupSchema.parse(req.body);

    const group = await loadWritableGroup(req, groupId);
    const organizationId = group.organizationId;
    const actor = await loadActor(req.user!.userId);
    const sharedPassword = resolveSharedPassword(data.password);

    // Кто уже в группе — молча пропускаем: повторное добавление упало бы на
    // уникальности (userId, groupId) и откатило бы всю операцию.
    const memberIds = new Set(group.members.map((m) => m.userId));
    const wanted = data.members.filter(
      (m) => m.action !== 'skip' && !(m.userId && memberIds.has(m.userId))
    );
    const skippedAsMembers = data.members.filter((m) => m.userId && memberIds.has(m.userId)).length;

    if (wanted.length === 0) {
      throw new AppError(400, 'Nobody to add — everyone from the list is already in this group');
    }

    const snapshot = await loadOrgSnapshot(organizationId);
    const prepared = await prepareMembers({
      actorRole: req.user!.role,
      organizationId,
      members: wanted,
      sharedPassword,
      takenLogins: new Set(snapshot.takenLogins.map((l) => l.toLowerCase())),
    });

    const inviteExpiresAt = new Date(Date.now() + data.invites.expiresInDays * 86_400_000);

    const created = await prisma.$transaction(
      async (tx) => {
        const rows = await insertMembers(tx, {
          groupId: group.id,
          organizationId,
          prepared,
          inviteExpiresAt,
          singleUse: data.invites.singleUse,
          actorId: actor.id,
          actorLabel: actor.label,
        });

        await tx.adminAuditLog.create({
          data: {
            organizationId,
            actorId: actor.id,
            actorLabel: actor.label,
            action: 'group.add_members',
            targetType: 'group',
            targetId: group.id,
            meta: {
              groupName: group.name,
              membersAdded: rows.length,
              membersCreated: rows.filter((c) => c.isNew).length,
              membersExisting: rows.filter((c) => !c.isNew).length,
              skippedAlreadyInGroup: skippedAsMembers,
              invitesIssued: rows.length,
              inviteExpiresAt: inviteExpiresAt.toISOString(),
              sharedPassword: data.password.mode === 'shared',
            } as Prisma.InputJsonValue,
            ip: req.ip ?? null,
          },
        });

        return rows;
      },
      { timeout: 60_000, maxWait: 10_000 }
    );

    emitOrgDataChanged(req, organizationId, 'members', { groupId: group.id, action: 'member_added' });
    emitOrgDataChanged(req, organizationId, 'users', { action: 'created' });

    logger.info({
      msg: 'Участники добавлены в существующую группу',
      groupId: group.id,
      groupName: group.name,
      organizationId,
      added: created.length,
      skippedAlreadyInGroup: skippedAsMembers,
    });

    res.status(201).json({
      group: {
        id: group.id,
        name: group.name,
        status: group.status,
        endsAt: group.endsAt,
        unlimited: !group.endsAt,
        color: group.color,
        priority: group.priority,
      },
      organization: group.organization,
      members: serializeCreated(created),
      invites: {
        expiresAt: inviteExpiresAt,
        singleUse: data.invites.singleUse,
        count: created.length,
      },
      skippedAlreadyInGroup: skippedAsMembers,
      sharedPassword,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Управление приглашениями ───────────────────────────────
// Токен хранится только хешем, поэтому «показать ещё раз» невозможно —
// можно лишь перевыпустить. Отсюда набор действий: посмотреть состояние,
// выпустить заново, отозвать.

/** Состояние приглашения на текущий момент, а не то, что записано в поле. */
function effectiveInviteStatus(invite: {
  status: InviteStatus;
  revokedAt: Date | null;
  expiresAt: Date;
  usedCount: number;
  maxUses: number;
}): InviteStatus {
  if (invite.status === InviteStatus.REVOKED || invite.revokedAt) return InviteStatus.REVOKED;
  if (invite.expiresAt < new Date()) return InviteStatus.EXPIRED;
  // maxUses = 0 означает «без ограничения по числу».
  if (invite.maxUses > 0 && invite.usedCount >= invite.maxUses) return InviteStatus.EXPIRED;
  return invite.status;
}

async function loadInviteForAdmin(req: Request, inviteId: string) {
  const invite = await prisma.invite.findUnique({
    where: { id: inviteId },
    include: {
      user: { select: { id: true, callsign: true, displayName: true, login: true, isActive: true } },
      group: { select: { id: true, name: true } },
    },
  });
  if (!invite) throw new AppError(404, 'Invitation not found');

  if (
    req.user!.role !== UserRole.SUPERADMIN &&
    invite.organizationId !== req.user!.organizationId
  ) {
    throw new AppError(403, 'Access denied');
  }

  return invite;
}

// ─── GET /api/onboarding/groups/:groupId/invites ─────────────
// Кто активировался, кто ещё нет, у кого истекло.

onboardingRouter.get('/groups/:groupId/invites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = z.string().uuid().parse(req.params.groupId);
    const group = await loadWritableGroup(req, groupId);

    const invites = await prisma.invite.findMany({
      where: { groupId: group.id },
      include: {
        user: { select: { id: true, callsign: true, displayName: true, login: true, isActive: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Участники без приглашения — например, добавленные вручную через Members.
    const invitedUserIds = new Set(invites.map((i) => i.userId));
    const uninvited = group.members
      .map((m) => m.userId)
      .filter((id) => !invitedUserIds.has(id));

    const uninvitedUsers = uninvited.length
      ? await prisma.user.findMany({
          where: { id: { in: uninvited } },
          select: { id: true, callsign: true, displayName: true, login: true, isActive: true },
        })
      : [];

    res.json({
      group: { id: group.id, name: group.name },
      invites: invites.map((i) => ({
        id: i.id,
        status: effectiveInviteStatus(i),
        user: i.user,
        expiresAt: i.expiresAt,
        maxUses: i.maxUses,
        usedCount: i.usedCount,
        singleUse: i.maxUses === 1,
        firstOpenedAt: i.firstOpenedAt,
        activatedAt: i.activatedAt,
        revokedAt: i.revokedAt,
        createdAt: i.createdAt,
        createdByLabel: i.createdByLabel,
        // Токена здесь нет и быть не может — в базе только его хеш.
      })),
      membersWithoutInvite: uninvitedUsers,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/onboarding/invites/:inviteId/revoke ───────────

onboardingRouter.post('/invites/:inviteId/revoke', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inviteId = z.string().uuid().parse(req.params.inviteId);
    const invite = await loadInviteForAdmin(req, inviteId);

    if (invite.revokedAt) {
      res.json({ id: invite.id, status: InviteStatus.REVOKED, alreadyRevoked: true });
      return;
    }

    const actor = await loadActor(req.user!.userId);
    const now = new Date();

    await prisma.$transaction([
      prisma.invite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.REVOKED, revokedAt: now },
      }),
      prisma.adminAuditLog.create({
        data: {
          organizationId: invite.organizationId,
          actorId: actor.id,
          actorLabel: actor.label,
          action: 'invite.revoke',
          targetType: 'invite',
          targetId: invite.id,
          meta: {
            callsign: invite.user.callsign,
            groupName: invite.group?.name ?? null,
            wasActivated: !!invite.activatedAt,
          } as Prisma.InputJsonValue,
          ip: req.ip ?? null,
        },
      }),
    ]);

    logger.info({
      msg: 'Приглашение отозвано',
      inviteId: invite.id,
      callsign: invite.user.callsign,
    });

    res.json({ id: invite.id, status: InviteStatus.REVOKED, revokedAt: now });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/onboarding/invites/:inviteId/reissue ──────────
// Старое приглашение отзывается, выпускается новое. Ссылка видна один раз.

const reissueSchema = z.object({
  expiresInDays: z.number().int().min(1).max(365).default(DEFAULT_INVITE_DAYS),
  singleUse: z.boolean().default(false),
});

onboardingRouter.post('/invites/:inviteId/reissue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inviteId = z.string().uuid().parse(req.params.inviteId);
    const options = reissueSchema.parse(req.body ?? {});
    const invite = await loadInviteForAdmin(req, inviteId);

    const actor = await loadActor(req.user!.userId);
    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + options.expiresInDays * 86_400_000);
    const now = new Date();

    const fresh = await prisma.$transaction(async (tx) => {
      // Старое обязательно гасим: иначе по рукам ходили бы две живые ссылки.
      await tx.invite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.REVOKED, revokedAt: invite.revokedAt ?? now },
      });

      const created = await tx.invite.create({
        data: {
          tokenHash: hashInviteToken(token),
          userId: invite.userId,
          groupId: invite.groupId,
          organizationId: invite.organizationId,
          expiresAt,
          maxUses: options.singleUse ? 1 : 0,
          createdById: actor.id,
          createdByLabel: actor.label,
        },
        select: { id: true, expiresAt: true, maxUses: true },
      });

      await tx.adminAuditLog.create({
        data: {
          organizationId: invite.organizationId,
          actorId: actor.id,
          actorLabel: actor.label,
          action: 'invite.reissue',
          targetType: 'invite',
          targetId: created.id,
          meta: {
            callsign: invite.user.callsign,
            groupName: invite.group?.name ?? null,
            replacedInviteId: invite.id,
            expiresAt: expiresAt.toISOString(),
          } as Prisma.InputJsonValue,
          ip: req.ip ?? null,
        },
      });

      return created;
    });

    logger.info({
      msg: 'Приглашение перевыпущено',
      oldInviteId: invite.id,
      newInviteId: fresh.id,
      callsign: invite.user.callsign,
    });

    res.status(201).json({
      id: fresh.id,
      status: InviteStatus.CREATED,
      user: invite.user,
      expiresAt: fresh.expiresAt,
      singleUse: fresh.maxUses === 1,
      // Ссылка видна ЕДИНСТВЕННЫЙ раз — дальше только новый перевыпуск.
      inviteUrl: buildInviteUrl(config.publicWebUrl, token),
      replacedInviteId: invite.id,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/onboarding/users/:userId/new-password ─────────
// Новый временный пароль, когда старый потерян. Показывается один раз.

onboardingRouter.post('/users/:userId/new-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = z.string().uuid().parse(req.params.userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, callsign: true, login: true, email: true, organizationId: true, role: true },
    });
    if (!user) throw new AppError(404, 'User not found');

    if (
      req.user!.role !== UserRole.SUPERADMIN &&
      user.organizationId !== req.user!.organizationId
    ) {
      throw new AppError(403, 'Access denied');
    }

    if (user.role === UserRole.SUPERADMIN && req.user!.role !== UserRole.SUPERADMIN) {
      throw new AppError(403, 'Cannot reset a superadmin password');
    }

    const actor = await loadActor(req.user!.userId);
    const password = generateTempPassword();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password: hash, mustChangePassword: true },
      }),
      // Смена пароля обрывает все живые сессии — так же, как в /users/:id/reset-password.
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
      prisma.adminAuditLog.create({
        data: {
          organizationId: user.organizationId,
          actorId: actor.id,
          actorLabel: actor.label,
          action: 'user.new_password',
          targetType: 'user',
          targetId: user.id,
          // Сам пароль в журнал НЕ попадает.
          meta: { callsign: user.callsign } as Prisma.InputJsonValue,
          ip: req.ip ?? null,
        },
      }),
    ]);

    logger.info({ msg: 'Выдан новый временный пароль', userId: user.id, callsign: user.callsign });

    res.json({
      userId: user.id,
      callsign: user.callsign,
      login: user.login,
      // Виден один раз.
      tempPassword: password,
    });
  } catch (err) {
    next(err);
  }
});
