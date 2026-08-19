/**
 * Генерация логинов из позывных для массового создания участников.
 *
 * Транслитерации здесь сознательно нет. Позывные ведутся латиницей (в проде
 * 0 из 22 с кириллицей), а главное — логин должен быть предсказуем для
 * администратора: он диктует его человеку голосом. "ЩЁГОЛЕВ" → "shchyogolev"
 * угадать невозможно, поэтому кириллица отклоняется с понятной ошибкой,
 * а не переводится молча.
 *
 * Логин не может содержать "@" — благодаря этому он никогда не пересечётся
 * с чьим-то email, хотя оба поля живут в одной таблице.
 */

/** Максимальная длина логина. Позывной по существующей схеме — до 20. */
export const LOGIN_MAX_LENGTH = 32;

/** Каким получается валидный логин: латиница, цифры, дефис и подчёркивание. */
export const LOGIN_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Что допускается во ВХОДНОМ позывном (до нормализации). */
const CALLSIGN_ALLOWED = /^[A-Za-z0-9 _-]+$/;

const CYRILLIC = /[Ѐ-ӿ]/;

export interface CallsignCheck {
  ok: boolean;
  /** Человекочитаемая причина отказа — показывается администратору как есть. */
  error?: string;
}

/**
 * Проверяет позывной перед генерацией логина.
 * Сообщения намеренно подсказывают, что именно исправить.
 */
export function validateCallsign(raw: string): CallsignCheck {
  const value = raw.trim();

  if (!value) {
    return { ok: false, error: 'empty line' };
  }

  if (CYRILLIC.test(value)) {
    return {
      ok: false,
      error: `"${value}" — Cyrillic is not supported, use Latin letters`,
    };
  }

  if (!CALLSIGN_ALLOWED.test(value)) {
    return {
      ok: false,
      error: `"${value}" — only Latin letters, digits, hyphen and underscore are allowed`,
    };
  }

  if (value.length < 2) {
    return { ok: false, error: `"${value}" — callsign is too short (minimum 2 characters)` };
  }

  if (value.length > 20) {
    return { ok: false, error: `"${value}" — callsign is too long (maximum 20 characters)` };
  }

  // Позывной из одних разделителей ("---") нормализуется в пустоту.
  if (!normalizeLogin(value)) {
    return { ok: false, error: `"${value}" — this callsign does not produce a login` };
  }

  return { ok: true };
}

/**
 * Позывной → базовый логин. Уникальность здесь НЕ проверяется, этим
 * занимается makeUniqueLogin.
 *
 *   "LV001"     → "lv001"
 *   "AMSAT-DL"  → "amsat-dl"
 *   "BASE 1"    → "base-1"
 *   "  RA3APR " → "ra3apr"
 */
export function normalizeLogin(callsign: string): string {
  return callsign
    .trim()
    .toLowerCase()
    // Пробелы — это разделители слов, поэтому становятся дефисом, а не пропадают:
    // "BASE 1" должен читаться как "base-1", а не слипнуться в "base1".
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, LOGIN_MAX_LENGTH)
    // Обрезка по длине могла оставить дефис на конце.
    .replace(/[-_]+$/g, '');
}

/**
 * Делает логин уникальным, добавляя понятный числовой суффикс.
 * `taken` — уже занятые логины (из базы + выданные в этом же прогоне);
 * функция его НЕ изменяет, за учёт отвечает вызывающий код.
 *
 *   makeUniqueLogin('dispatcher', {'dispatcher'})              → 'dispatcher-2'
 *   makeUniqueLogin('dispatcher', {'dispatcher','dispatcher-2'}) → 'dispatcher-3'
 */
export function makeUniqueLogin(base: string, taken: ReadonlySet<string>): string {
  if (!base) throw new Error('makeUniqueLogin: empty login base');

  if (!taken.has(base)) return base;

  for (let n = 2; n < 10_000; n++) {
    const suffix = `-${n}`;
    // Суффикс не должен выталкивать логин за предел длины.
    const stem = base.slice(0, LOGIN_MAX_LENGTH - suffix.length).replace(/[-_]+$/g, '');
    const candidate = `${stem}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new Error(`makeUniqueLogin: could not derive a free login for "${base}"`);
}

export interface ParsedCallsigns {
  /** Позывные в порядке ввода, без пустых строк и без повторов. */
  callsigns: string[];
  /** Повторы внутри самого списка — показываем администратору как предупреждение. */
  duplicates: string[];
}

/**
 * Разбирает то, что администратор вставил в поле «Участники»: по одному в
 * строке, через запятую или вперемешку. Лишние пробелы убираются, повторы
 * внутри списка схлопываются (сравнение без учёта регистра).
 */
export function parseCallsignList(input: string): ParsedCallsigns {
  const callsigns: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const raw of input.split(/[\n,;]+/)) {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(value);
      continue;
    }

    seen.add(key);
    callsigns.push(value);
  }

  return { callsigns, duplicates };
}

export interface LoginAssignment {
  callsign: string;
  login: string;
}

export interface AssignLoginsResult {
  assigned: LoginAssignment[];
  /** Позывные, не прошедшие проверку, с готовым текстом ошибки. */
  rejected: { callsign: string; error: string }[];
}

/**
 * Основная точка входа для вопросника: список позывных → список логинов.
 * `existingLogins` — то, что уже занято в базе (в нижнем регистре).
 *
 * Логины, выданные в этом же прогоне, тоже становятся занятыми, поэтому два
 * одинаковых позывных в одном списке получат разные логины.
 */
export function assignLogins(
  callsigns: readonly string[],
  existingLogins: readonly string[] = []
): AssignLoginsResult {
  const taken = new Set(existingLogins.map((l) => l.toLowerCase()));
  const assigned: LoginAssignment[] = [];
  const rejected: { callsign: string; error: string }[] = [];

  for (const callsign of callsigns) {
    const check = validateCallsign(callsign);
    if (!check.ok) {
      rejected.push({ callsign, error: check.error! });
      continue;
    }

    const login = makeUniqueLogin(normalizeLogin(callsign), taken);
    taken.add(login);
    assigned.push({ callsign: callsign.trim(), login });
  }

  return { assigned, rejected };
}
