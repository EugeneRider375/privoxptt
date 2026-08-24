import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isDeadTokenReason, topicFor } from './apns';

/**
 * Проверяем то, что можно проверить без Apple: составление темы и разбор
 * причин отказа. Саму отправку в APNs проверить можно только с живым
 * устройством, зарегистрировавшим VoIP-токен, — это уже на MacBook.
 */

describe('topicFor', () => {
  test('у VoIP-push к идентификатору приложения добавляется .voip', () => {
    assert.equal(topicFor('voip', 'tech.privox.ptt'), 'tech.privox.ptt.voip');
  });

  test('у обычного push тема равна идентификатору приложения', () => {
    assert.equal(topicFor('alert', 'tech.privox.ptt'), 'tech.privox.ptt');
  });

  test('темы двух типов не совпадают — перепутать их значит не доставить ничего', () => {
    assert.notEqual(topicFor('voip', 'tech.privox.ptt'), topicFor('alert', 'tech.privox.ptt'));
  });
});

describe('isDeadTokenReason', () => {
  // Эти три Apple возвращает, когда токен больше не адресует живое
  // приложение: устройство стёрли, приложение удалили, тема не та.
  // По ним токен надо гасить, иначе будем долбиться в пустоту вечно.
  test('мёртвые токены распознаются', () => {
    assert.equal(isDeadTokenReason('BadDeviceToken'), true);
    assert.equal(isDeadTokenReason('Unregistered'), true);
    assert.equal(isDeadTokenReason('DeviceTokenNotForTopic'), true);
  });

  test('временные отказы мёртвыми НЕ считаются — иначе разлогиним всех при сбое', () => {
    assert.equal(isDeadTokenReason('TooManyRequests'), false);
    assert.equal(isDeadTokenReason('InternalServerError'), false);
    assert.equal(isDeadTokenReason('ServiceUnavailable'), false);
    assert.equal(isDeadTokenReason('ExpiredProviderToken'), false);
  });

  test('пустая причина не считается мёртвым токеном', () => {
    assert.equal(isDeadTokenReason(undefined), false);
    assert.equal(isDeadTokenReason(''), false);
  });
});
