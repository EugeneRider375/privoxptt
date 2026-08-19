import crypto from 'crypto';

/**
 * Временные пароли и токены приглашений.
 *
 * Правила, заданные заказчиком:
 *  - в базе только безопасные хеши, открытых паролей нет;
 *  - в журналы пароли и токены не пишутся;
 *  - администратору первичный пароль показывается один раз, при создании;
 *  - общий пароль на всех — только как осознанная опция с предупреждением.
 */

/**
 * Алфавит без пар, которые путают при чтении вслух и переписывании от руки:
 * убраны 0/O/o, 1/l/I. Пароль диктуют по телефону — это важнее энтропии
 * пары лишних символов.
 */
const PASSWORD_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const TEMP_PASSWORD_LENGTH = 12;

/**
 * Временный пароль. crypto.randomInt даёт равномерное распределение —
 * в отличие от `Math.random()` и от `% alphabet.length`, где начало
 * алфавита выпадает чаще.
 */
export function generateTempPassword(length = TEMP_PASSWORD_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

/** 256 бит случайности. base64url — можно класть в URL без экранирования. */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * В базе лежит только этот хеш. Токен восстановить из него нельзя, поэтому
 * утечка дампа не даёт активировать чужое приглашение.
 *
 * Здесь достаточно sha256, а не bcrypt: токен — 256 бит подлинной
 * случайности, перебирать его бессмысленно, в отличие от пароля,
 * придуманного человеком.
 */
export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Ссылка, которая уйдёт в QR-код. */
export function buildInviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/join/${token}`;
}

/** Мягкая проверка качества общего пароля, когда админ задаёт его вручную. */
export function checkSharedPassword(password: string): { ok: boolean; error?: string } {
  if (password.length < 8) {
    return { ok: false, error: 'Password is shorter than 8 characters' };
  }
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
    return { ok: false, error: 'Password must contain letters and digits' };
  }
  return { ok: true };
}
