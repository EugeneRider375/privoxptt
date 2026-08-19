import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEMP_PASSWORD_LENGTH,
  buildInviteUrl,
  checkSharedPassword,
  generateInviteToken,
  generateTempPassword,
  hashInviteToken,
} from './credentials';

describe('generateTempPassword', () => {
  test('длина по умолчанию', () => {
    assert.equal(generateTempPassword().length, TEMP_PASSWORD_LENGTH);
  });

  test('длина задаётся', () => {
    assert.equal(generateTempPassword(20).length, 20);
  });

  test('не содержит символов, которые путают при чтении вслух', () => {
    // 1000 паролей — достаточно, чтобы поймать случайное попадание.
    for (let i = 0; i < 1000; i++) {
      assert.doesNotMatch(generateTempPassword(), /[0O1lI]/);
    }
  });

  test('пароли не повторяются', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateTempPassword()));
    assert.equal(set.size, 500);
  });

  test('используется больше одного символа алфавита', () => {
    const chars = new Set(generateTempPassword(200).split(''));
    assert.ok(chars.size > 20, `символов всего ${chars.size}`);
  });
});

describe('generateInviteToken', () => {
  test('безопасен для URL — только base64url-алфавит', () => {
    for (let i = 0; i < 200; i++) {
      assert.match(generateInviteToken(), /^[A-Za-z0-9_-]+$/);
    }
  });

  test('длина соответствует 256 битам', () => {
    assert.equal(generateInviteToken().length, 43);
  });

  test('токены не повторяются', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateInviteToken()));
    assert.equal(set.size, 1000);
  });
});

describe('hashInviteToken', () => {
  test('даёт sha256 в hex', () => {
    const hash = hashInviteToken('abc');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });

  test('одинаковый вход — одинаковый хеш', () => {
    const token = generateInviteToken();
    assert.equal(hashInviteToken(token), hashInviteToken(token));
  });

  test('разный вход — разный хеш', () => {
    assert.notEqual(hashInviteToken('a'), hashInviteToken('b'));
  });

  test('хеш не содержит исходный токен', () => {
    const token = generateInviteToken();
    assert.ok(!hashInviteToken(token).includes(token));
  });
});

describe('buildInviteUrl', () => {
  test('собирает ссылку вида /join/<токен>', () => {
    assert.equal(
      buildInviteUrl('https://ptt.privox.tech', 'abc123'),
      'https://ptt.privox.tech/join/abc123'
    );
  });

  test('лишний слэш в конце базового адреса не ломает ссылку', () => {
    assert.equal(
      buildInviteUrl('https://ptt.privox.tech/', 'abc123'),
      'https://ptt.privox.tech/join/abc123'
    );
    assert.equal(
      buildInviteUrl('https://ptt.privox.tech///', 'abc123'),
      'https://ptt.privox.tech/join/abc123'
    );
  });

  test('токен в ссылке не требует экранирования', () => {
    const token = generateInviteToken();
    const url = buildInviteUrl('https://ptt.privox.tech', token);
    assert.equal(encodeURI(url), url);
  });
});

describe('checkSharedPassword', () => {
  test('пропускает нормальный пароль', () => {
    assert.equal(checkSharedPassword('Brigada2026').ok, true);
  });

  test('отклоняет короткий', () => {
    assert.equal(checkSharedPassword('abc12').ok, false);
  });

  test('отклоняет без цифр', () => {
    assert.equal(checkSharedPassword('onlyletters').ok, false);
  });

  test('отклоняет без букв', () => {
    assert.equal(checkSharedPassword('12345678').ok, false);
  });
});
