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
      singleUse: z.boolean().default(true),
    })
    .default({ expiresInDays: DEFAULT_INVITE_DAYS, singleUse: true }),
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
 */
function buildPreviewRows(membersText: string, snapshot: OrgSnapshot) {
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
        },
        // По умолчанию НЕ плодим дубли: берём существующего пользователя.
        defaultAction: 'use_existing',
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

    const actor = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, callsign: true, login: true, email: true },
    });

    // ── Общий пароль: только осознанно ─────────────────────
    let sharedPassword: string | null = null;
    if (data.password.mode === 'shared') {
      if (!data.password.acknowledgeSharedRisk) {
        throw new AppError(
          400,
          'A password shared by all members is a risk: any of them can sign in as another. ' +
            'Confirm that you accept this risk to continue.'
        );
      }
      sharedPassword = data.password.sharedPassword?.trim() || generateTempPassword();
      const quality = checkSharedPassword(sharedPassword);
      if (!quality.ok) throw new AppError(400, quality.error!);
    }

    const wanted = data.members.filter((m) => m.action !== 'skip');
    if (wanted.length === 0) {
      throw new AppError(400, 'The group has no members');
    }

    const snapshot = await loadOrgSnapshot(organizationId);
    const takenLogins = new Set(snapshot.takenLogins.map((l) => l.toLowerCase()));

    // ── Подготовка вне транзакции ──────────────────────────
    // Всё тяжёлое считается ДО открытия транзакции: bcrypt при 12 раундах
    // занимает ~250 мс на пароль, и держать транзакцию открытой всё это
    // время — значит блокировать таблицы на десятки секунд.
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

    // Проход 1: проверки без обращений к базе.
    const toCreate: (Prepared & { action: 'create' })[] = [];
    const toReuse: { userId: string; callsign: string; perms: Omit<Prepared, 'action' | 'callsign' | 'displayName'> }[] = [];

    for (const m of wanted) {
      const role = m.role ?? UserRole.USER;

      if (role === UserRole.SUPERADMIN && req.user!.role !== UserRole.SUPERADMIN) {
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
    const prepared: Prepared[] = [
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

    const inviteExpiresAt = new Date(
      Date.now() + data.invites.expiresInDays * 24 * 60 * 60 * 1000
    );
    const actorLabel = actor?.callsign || actor?.login || actor?.email || 'unknown';

    // ── Одна транзакция: всё или ничего ────────────────────
    const result = await prisma.$transaction(async (tx) => {
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

      const created: {
        userId: string;
        callsign: string;
        displayName: string;
        login: string | null;
        isNew: boolean;
        tempPassword?: string;
        inviteId: string;
        inviteToken: string;
      }[] = [];

      for (const p of prepared) {
        let userId = p.userId!;

        if (p.action === 'create') {
          const user = await tx.user.create({
            data: {
              callsign: p.callsign,
              displayName: p.displayName,
              login: p.login!,
              password: p.passwordHash!,
              role: p.role,
              organizationId,
              mustChangePassword: true,
            },
            select: { id: true },
          });
          userId = user.id;
        }

        await tx.groupMember.create({
          data: {
            groupId: group.id,
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
            groupId: group.id,
            organizationId,
            expiresAt: inviteExpiresAt,
            maxUses: data.invites.singleUse ? 1 : 0, // 0 = без ограничения по числу
            createdById: actor?.id ?? null,
            createdByLabel: actorLabel,
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

      await tx.adminAuditLog.create({
        data: {
          organizationId,
          actorId: actor?.id ?? null,
          actorLabel,
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
    }, {
      // Массовое создание с bcrypt уже посчитанным заранее укладывается быстро,
      // но при 200 участниках запас нужен.
      timeout: 60_000,
      maxWait: 10_000,
    });

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
      /**
       * Пароли и токены приглашений возвращаются ЕДИНСТВЕННЫЙ раз — здесь.
       * В базе от них только хеши, повторно показать их невозможно,
       * можно лишь перевыпустить.
       */
      members: result.created.map((c) => ({
        userId: c.userId,
        callsign: c.callsign,
        displayName: c.displayName,
        login: c.login,
        isNew: c.isNew,
        tempPassword: c.tempPassword ?? null,
        inviteId: c.inviteId,
        inviteUrl: buildInviteUrl(config.publicWebUrl, c.inviteToken),
      })),
      invites: {
        expiresAt: inviteExpiresAt,
        singleUse: data.invites.singleUse,
        count: result.created.length,
      },
      sharedPassword: data.password.mode === 'shared' ? sharedPassword : null,
    });
  } catch (err) {
    next(err);
  }
});
