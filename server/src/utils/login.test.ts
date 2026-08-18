import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOGIN_PATTERN,
  assignLogins,
  makeUniqueLogin,
  normalizeLogin,
  parseCallsignList,
  validateCallsign,
} from './login';

// Настоящие позывные из боевой базы — на них генератор обязан работать
// без единого отказа. DISPATCHER там встречается дважды: это реальный
// конфликт, а не выдуманный тестовый случай.
const PROD_CALLSIGNS = [
  'AMSATDL', 'ANTON', 'BASE1', 'BASE2', 'DB2OS', 'DISPATCHER', 'DISPATCHER',
  'ELENA', 'EUGENE', 'EVGENY', 'JOHN', 'LV001', 'LV002', 'LV003', 'LV004',
  'MAX', 'NATA', 'RA3APR', 'RADIO', 'ROL', 'SERGE', 'SUPERADMIN',
];

describe('normalizeLogin', () => {
  test('приводит к нижнему регистру', () => {
    assert.equal(normalizeLogin('LV001'), 'lv001');
    assert.equal(normalizeLogin('DB2OS'), 'db2os');
  });

  test('сохраняет дефис', () => {
    assert.equal(normalizeLogin('AMSAT-DL'), 'amsat-dl');
  });

  test('пробел превращается в дефис, а не пропадает', () => {
    assert.equal(normalizeLogin('BASE 1'), 'base-1');
    assert.equal(normalizeLogin('GROUP SM'), 'group-sm');
  });

  test('срезает лишние пробелы по краям', () => {
    assert.equal(normalizeLogin('  RA3APR  '), 'ra3apr');
  });

  test('схлопывает повторяющиеся дефисы', () => {
    assert.equal(normalizeLogin('AMSAT--DL'), 'amsat-dl');
    assert.equal(normalizeLogin('A   B'), 'a-b');
  });

  test('убирает разделители с краёв', () => {
    assert.equal(normalizeLogin('-BASE1-'), 'base1');
    assert.equal(normalizeLogin('_ROL_'), 'rol');
  });

  test('выбрасывает недопустимые символы', () => {
    assert.equal(normalizeLogin('BASE#1!'), 'base1');
    assert.equal(normalizeLogin('a.b'), 'ab');
  });

  test('никогда не содержит @ — не пересечётся с email', () => {
    assert.equal(normalizeLogin('user@mail.com'), 'usermailcom');
    assert.ok(!normalizeLogin('user@mail.com').includes('@'));
  });

  test('обрезает по длине, не оставляя дефис на конце', () => {
    const long = 'A'.repeat(30) + '-' + 'B'.repeat(10);
    const login = normalizeLogin(long);
    assert.ok(login.length <= 32);
    assert.ok(!login.endsWith('-'));
  });

  test('из одних разделителей получается пустота', () => {
    assert.equal(normalizeLogin('---'), '');
    assert.equal(normalizeLogin('   '), '');
  });
});

describe('validateCallsign', () => {
  test('пропускает все реальные позывные прода', () => {
    for (const callsign of PROD_CALLSIGNS) {
      assert.ok(validateCallsign(callsign).ok, `отклонён реальный позывной ${callsign}`);
    }
  });

  test('отклоняет кириллицу с понятной подсказкой', () => {
    const result = validateCallsign('ИВАНОВ');
    assert.equal(result.ok, false);
    assert.match(result.error!, /Cyrillic/);
    assert.match(result.error!, /Latin/);
  });

  test('отклоняет отдельную кириллическую букву внутри латиницы', () => {
    // Классическая ловушка: русская "А" неотличима на вид от латинской.
    assert.equal(validateCallsign('BАSE1').ok, false);
  });

  test('отклоняет пустую строку', () => {
    assert.equal(validateCallsign('').ok, false);
    assert.equal(validateCallsign('   ').ok, false);
  });

  test('отклоняет слишком короткий', () => {
    assert.equal(validateCallsign('A').ok, false);
  });

  test('отклоняет слишком длинный', () => {
    assert.equal(validateCallsign('A'.repeat(21)).ok, false);
  });

  test('отклоняет позывной, из которого не выходит логин', () => {
    assert.equal(validateCallsign('---').ok, false);
  });

  test('в тексте ошибки виден сам позывной', () => {
    assert.match(validateCallsign('ИВАНОВ').error!, /ИВАНОВ/);
  });
});

describe('makeUniqueLogin', () => {
  test('свободный логин отдаётся как есть', () => {
    assert.equal(makeUniqueLogin('elena', new Set()), 'elena');
  });

  test('занятый получает суффикс -2', () => {
    assert.equal(makeUniqueLogin('dispatcher', new Set(['dispatcher'])), 'dispatcher-2');
  });

  test('суффиксы растут по порядку', () => {
    const taken = new Set(['dispatcher', 'dispatcher-2', 'dispatcher-3']);
    assert.equal(makeUniqueLogin('dispatcher', taken), 'dispatcher-4');
  });

  test('не изменяет переданное множество', () => {
    const taken = new Set(['rol']);
    makeUniqueLogin('rol', taken);
    assert.equal(taken.size, 1);
  });

  test('суффикс не выталкивает логин за предел длины', () => {
    const base = 'a'.repeat(32);
    const taken = new Set([base]);
    const result = makeUniqueLogin(base, taken);
    assert.ok(result.length <= 32, `длина ${result.length}`);
    assert.ok(result.endsWith('-2'));
  });
});

describe('parseCallsignList', () => {
  test('по одному в строке', () => {
    const { callsigns } = parseCallsignList('LV001\nLV002\nLV003');
    assert.deepEqual(callsigns, ['LV001', 'LV002', 'LV003']);
  });

  test('через запятую', () => {
    const { callsigns } = parseCallsignList('LV001, LV002, LV003');
    assert.deepEqual(callsigns, ['LV001', 'LV002', 'LV003']);
  });

  test('вперемешку, с пустыми строками и лишними пробелами', () => {
    const { callsigns } = parseCallsignList('  LV001 ,\n\n  LV002\n , LV003  \n\n');
    assert.deepEqual(callsigns, ['LV001', 'LV002', 'LV003']);
  });

  test('схлопывает повторы внутри списка и сообщает о них', () => {
    const { callsigns, duplicates } = parseCallsignList('ROL\nMAX\nrol');
    assert.deepEqual(callsigns, ['ROL', 'MAX']);
    assert.deepEqual(duplicates, ['rol']);
  });

  test('внутренние пробелы схлопываются в один', () => {
    const { callsigns } = parseCallsignList('BASE    1');
    assert.deepEqual(callsigns, ['BASE 1']);
  });

  test('пустой ввод даёт пустой список, а не ошибку', () => {
    assert.deepEqual(parseCallsignList('').callsigns, []);
    assert.deepEqual(parseCallsignList('\n\n,,  ,\n').callsigns, []);
  });
});

describe('assignLogins', () => {
  test('весь боевой список проходит без отказов', () => {
    const { assigned, rejected } = assignLogins(PROD_CALLSIGNS);
    assert.equal(rejected.length, 0);
    assert.equal(assigned.length, PROD_CALLSIGNS.length);
  });

  test('два одинаковых позывных получают разные логины', () => {
    const { assigned } = assignLogins(['DISPATCHER', 'DISPATCHER']);
    assert.deepEqual(assigned.map((a) => a.login), ['dispatcher', 'dispatcher-2']);
  });

  test('все выданные логины уникальны', () => {
    const { assigned } = assignLogins(PROD_CALLSIGNS);
    const logins = assigned.map((a) => a.login);
    assert.equal(new Set(logins).size, logins.length);
  });

  test('все выданные логины соответствуют формату', () => {
    const { assigned } = assignLogins(PROD_CALLSIGNS);
    for (const { login } of assigned) {
      assert.match(login, LOGIN_PATTERN, `неверный формат: ${login}`);
    }
  });

  test('учитывает логины, уже занятые в базе', () => {
    const { assigned } = assignLogins(['ELENA'], ['elena']);
    assert.equal(assigned[0]!.login, 'elena-2');
  });

  test('занятые в базе сравниваются без учёта регистра', () => {
    const { assigned } = assignLogins(['ELENA'], ['ELENA']);
    assert.equal(assigned[0]!.login, 'elena-2');
  });

  test('плохие позывные отсеиваются, хорошие обрабатываются', () => {
    const { assigned, rejected } = assignLogins(['LV001', 'ИВАНОВ', 'LV002']);
    assert.deepEqual(assigned.map((a) => a.login), ['lv001', 'lv002']);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]!.callsign, 'ИВАНОВ');
  });

  test('позывной в результате сохраняется обрезанным, но не изменённым', () => {
    const { assigned } = assignLogins(['  LV001  ']);
    assert.equal(assigned[0]!.callsign, 'LV001');
    assert.equal(assigned[0]!.login, 'lv001');
  });

  test('пустой список — пустой результат', () => {
    const { assigned, rejected } = assignLogins([]);
    assert.equal(assigned.length, 0);
    assert.equal(rejected.length, 0);
  });
});
