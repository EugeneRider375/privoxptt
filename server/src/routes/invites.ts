import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { InviteStatus, UserRole } from '@prisma/client';

import { prisma } from '../database/prisma';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { hashInviteToken } from '../utils/credentials';
import {
  generateAccessToken,
  generateRefreshToken,
  refreshTokenExpiresAt,
  JwtPayload,
} from '../middleware/auth';

/**
 * Приглашение по персональному QR: то, куда ведёт ссылка /join/<токен>.
 *
 * Публичный роутер — токен здесь и есть удостоверение, JWT ещё нет.
 * Отсюда особая осторожность:
 *  - в базе только sha256 от токена, ищем по хешу;
 *  - жёсткий лимит запросов, чтобы токен нельзя было подбирать;
 *  - в ответ не попадает ничего, кроме имени, позывного и названия группы;
 *  - причина отказа не выдаёт, существовал ли токен вообще.
 */
export const invitesRouter = Router();

/**
 * Подбор 256-битного токена нереален, но лимит закрывает и перебор, и
 * случайную петлю запросов от клиента.
 */
const inviteLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please wait a minute' },
});

invitesRouter.use(inviteLimiter);

const tokenSchema = z.string().trim().min(20).max(200);

type InviteState = 'VALID' | 'EXPIRED' | 'REVOKED' | 'USED' | 'NOT_FOUND' | 'BLOCKED';

interface ResolvedInvite {
  state: InviteState;
  invite?: Awaited<ReturnType<typeof findInvite>>;
}

function findInvite(tokenHash: string) {
  return prisma.invite.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true, callsign: true, displayName: true, login: true,
          role: true, isActive: true, accessExpiresAt: true,
          organizationId: true,
          organization: { select: { id: true, name: true, slug: true } },
        },
      },
      group: { select: { id: true, name: true, color: true, status: true, endsAt: true } },
    },
  });
}

/** Все проверки годности в одном месте — их читают и /resolve, и /activate. */
async function resolveInvite(rawToken: string): Promise<ResolvedInvite> {
  const invite = await findInvite(hashInviteToken(rawToken));

  if (!invite) return { state: 'NOT_FOUND' };
  if (invite.status === InviteStatus.REVOKED || invite.revokedAt) return { state: 'REVOKED', invite };
  if (invite.expiresAt < new Date()) return { state: 'EXPIRED', invite };

  // maxUses = 0 означает «без ограничения по числу», только по сроку.
  if (invite.maxUses > 0 && invite.usedCount >= invite.maxUses) return { state: 'USED', invite };

  // Суперадмин по ссылке не входит: такой QR давал бы полный доступ ко всем
  // организациям любому, кто его перехватил. Только логин с паролем.
  if (invite.user.role === UserRole.SUPERADMIN) return { state: 'BLOCKED', invite };

  // Аккаунт отключён или у него истёк срок доступа — приглашение бесполезно.
  if (!invite.user.isActive) return { state: 'BLOCKED', invite };
  if (invite.user.accessExpiresAt && invite.user.accessExpiresAt < new Date()) {
    return { state: 'BLOCKED', invite };
  }

  return { state: 'VALID', invite };
}

/** Понятная человеку причина. Для несуществующего токена — та же формулировка,
 *  что и для отозванного: посторонний не должен различать эти случаи. */
const STATE_MESSAGE: Record<Exclude<InviteState, 'VALID'>, string> = {
  NOT_FOUND: 'This invitation link is not valid',
  REVOKED: 'This invitation link is not valid',
  EXPIRED: 'This invitation has expired',
  USED: 'This invitation has already been used',
  BLOCKED: 'This account is not active — contact your administrator',
};

// ─── GET /api/invites/:token ────────────────────────────────
// Что это за приглашение. Ничего не активирует; помечает «открыто».

invitesRouter.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const { state, invite } = await resolveInvite(token);

    if (state !== 'VALID' || !invite) {
      res.status(state === 'NOT_FOUND' ? 404 : 410).json({
        valid: false,
        state,
        error: STATE_MESSAGE[state as Exclude<InviteState, 'VALID'>],
      });
      return;
    }

    // Отмечаем первый показ — администратору видно, что ссылка дошла.
    if (!invite.firstOpenedAt) {
      await prisma.invite.update({
        where: { id: invite.id },
        data: {
          firstOpenedAt: new Date(),
          status: invite.status === InviteStatus.CREATED ? InviteStatus.OPENED : invite.status,
        },
      });
    }

    res.json({
      valid: true,
      state,
      user: {
        callsign: invite.user.callsign,
        displayName: invite.user.displayName,
        // Логин показываем: он же резервный способ входа, пусть человек его увидит.
        login: invite.user.login,
      },
      organization: invite.user.organization,
      group: invite.group
        ? { name: invite.group.name, color: invite.group.color }
        : null,
      expiresAt: invite.expiresAt,
      // Уже активировано раньше и открыто снова — это нормальный повторный вход
      // (например, человек ставит приложение после браузера).
      alreadyActivated: !!invite.activatedAt,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/invites/:token/activate ──────────────────────
// Обмен приглашения на обычную сессию. Пароль не требуется — в этом весь смысл QR.

invitesRouter.post('/:token/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = tokenSchema.parse(req.params.token);
    const { state, invite } = await resolveInvite(token);

    if (state !== 'VALID' || !invite) {
      throw new AppError(
        state === 'NOT_FOUND' ? 404 : 410,
        STATE_MESSAGE[state as Exclude<InviteState, 'VALID'>],
        state
      );
    }

    const user = invite.user;
    const payload: JwtPayload = {
      userId: user.id,
      role: user.role,
      organizationId: user.organizationId,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);
    const now = new Date();

    await prisma.$transaction([
      prisma.refreshToken.create({
        data: { token: refreshToken, userId: user.id, expiresAt: refreshTokenExpiresAt(refreshToken) },
      }),
      prisma.invite.update({
        where: { id: invite.id },
        data: {
          usedCount: { increment: 1 },
          status: InviteStatus.ACTIVATED,
          activatedAt: invite.activatedAt ?? now,
        },
      }),
      prisma.user.update({ where: { id: user.id }, data: { lastSeen: now } }),
      prisma.adminAuditLog.create({
        data: {
          organizationId: user.organizationId,
          actorId: user.id,
          actorLabel: user.callsign,
          action: 'invite.activate',
          targetType: 'invite',
          targetId: invite.id,
          // Токена здесь нет и быть не должно.
          meta: { groupId: invite.groupId, groupName: invite.group?.name ?? null },
          ip: req.ip ?? null,
        },
      }),
    ]);

    logger.info({
      msg: 'Приглашение активировано',
      userId: user.id,
      callsign: user.callsign,
      groupId: invite.groupId,
    });

    // Ответ намеренно совпадает по форме с /api/auth/login: клиент кладёт
    // токены туда же и дальше живёт обычной сессией.
    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: null,
        login: user.login,
        callsign: user.callsign,
        displayName: user.displayName,
        role: user.role,
        mustChangePassword: false,
        organization: user.organization,
      },
      group: invite.group ? { id: invite.group.id, name: invite.group.name } : null,
    });
  } catch (err) {
    next(err);
  }
});
