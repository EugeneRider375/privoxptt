import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { assertPeriodOrder, checkGroupWindow, openGroupFilter, type GroupWindow } from './groupAccess';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const HOUR = 3_600_000;

function group(over: Partial<GroupWindow> = {}): GroupWindow {
  return { status: 'ACTIVE', startsAt: null, endsAt: null, ...over } as GroupWindow;
}

function closedReason(g: GroupWindow, now: Date = NOW) {
  const check = checkGroupWindow(g, now);
  return check.open ? null : check.reason;
}

describe('checkGroupWindow', () => {
  test('бессрочная группа открыта — так у всех, кто был до появления сроков', () => {
    assert.deepEqual(checkGroupWindow(group(), NOW), { open: true });
  });

  test('ACTIVE внутри окна открыта', () => {
    const g = group({
      startsAt: new Date(NOW.getTime() - HOUR),
      endsAt: new Date(NOW.getTime() + HOUR),
    });
    assert.deepEqual(checkGroupWindow(g, NOW), { open: true });
  });

  test('истёкшая группа закрыта — это и есть D7', () => {
    const g = group({ endsAt: new Date(NOW.getTime() - 1) });
    assert.equal(closedReason(g), 'group_expired');
  });

  test('ещё не начавшаяся группа закрыта', () => {
    const g = group({ startsAt: new Date(NOW.getTime() + 1) });
    assert.equal(closedReason(g), 'group_not_started');
  });

  test('DRAFT закрыт даже без дат', () => {
    assert.equal(closedReason(group({ status: 'DRAFT' } as Partial<GroupWindow>)), 'group_draft');
  });

  test('ARCHIVED закрыт даже внутри окна', () => {
    const g = group({
      status: 'ARCHIVED',
      startsAt: new Date(NOW.getTime() - HOUR),
      endsAt: new Date(NOW.getTime() + HOUR),
    } as Partial<GroupWindow>);
    assert.equal(closedReason(g), 'group_archived');
  });

  test('границы включительные: ровно в startsAt уже открыта, ровно в endsAt ещё открыта', () => {
    assert.equal(checkGroupWindow(group({ startsAt: NOW }), NOW).open, true);
    assert.equal(checkGroupWindow(group({ endsAt: NOW }), NOW).open, true);
    // а на миллисекунду позже endsAt — уже закрыта
    assert.equal(closedReason(group({ endsAt: NOW }), new Date(NOW.getTime() + 1)), 'group_expired');
  });

  test('статус важнее дат: ARCHIVED побеждает открытое окно, DRAFT — тоже', () => {
    const inWindow = { startsAt: new Date(NOW.getTime() - HOUR), endsAt: new Date(NOW.getTime() + HOUR) };
    assert.equal(closedReason(group({ ...inWindow, status: 'ARCHIVED' } as Partial<GroupWindow>)), 'group_archived');
    assert.equal(closedReason(group({ ...inWindow, status: 'DRAFT' } as Partial<GroupWindow>)), 'group_draft');
  });

  test('в сообщении об истечении есть дата — человеку в поле надо знать, когда', () => {
    const endsAt = new Date(NOW.getTime() - HOUR);
    const check = checkGroupWindow(group({ endsAt }), NOW);
    assert.equal(check.open, false);
    assert.ok(!check.open && check.message.includes(endsAt.toISOString()));
  });
});

describe('openGroupFilter', () => {
  // Фильтр для БД и checkGroupWindow должны судить одинаково — иначе группа,
  // невидимая в списке, окажется доступной в сокете (или наоборот).
  test('пропускает только ACTIVE', () => {
    assert.equal(openGroupFilter(NOW).status, 'ACTIVE');
  });

  test('null-даты трактуются как бессрочность', () => {
    const filter = openGroupFilter(NOW);
    const [startClause, endClause] = filter.AND as [{ OR: unknown[] }, { OR: unknown[] }];
    assert.deepEqual(startClause.OR[0], { startsAt: null });
    assert.deepEqual(startClause.OR[1], { startsAt: { lte: NOW } });
    assert.deepEqual(endClause.OR[0], { endsAt: null });
    assert.deepEqual(endClause.OR[1], { endsAt: { gte: NOW } });
  });
});

describe('assertPeriodOrder', () => {
  const start = new Date('2026-08-21T10:00:00.000Z');

  test('нормальный порядок проходит', () => {
    assertPeriodOrder(start, new Date('2026-08-21T18:00:00.000Z'));
  });

  test('бессрочность в любом виде проходит', () => {
    assertPeriodOrder(null, null);
    assertPeriodOrder(start, null);
    assertPeriodOrder(null, new Date('2026-08-21T18:00:00.000Z'));
  });

  test('конец раньше начала отвергается', () => {
    assert.throws(
      () => assertPeriodOrder(start, new Date('2026-08-21T09:00:00.000Z')),
      /End date must be later/,
    );
  });

  test('совпадающие даты отвергаются — окно нулевой длины бессмысленно', () => {
    assert.throws(() => assertPeriodOrder(start, new Date(start)), /End date must be later/);
  });
});
