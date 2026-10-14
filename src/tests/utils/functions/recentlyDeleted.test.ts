import { afterEach, describe, expect, it } from 'vitest';

import { buildSession } from '../../fixtures/sessionFixture';
import { setupChromeFake } from '../../setup/chrome.fake';
import { TOMBSTONE_TTL_MS } from '../../../utils/functions/mergeTabData';
import {
  RECENTLY_DELETED_KEY,
  RECENTLY_DELETED_MAX,
  deletedSessionsFrom,
  emptyDeleted,
  readDeleted,
  recordDeleted,
  shownDeleted,
  withDeleted,
} from '../../../utils/functions/recentlyDeleted';

// KAN-595. Sessions deleted on this device, kept 30 days, 100 at most.

const NOW = Date.UTC(2026, 9, 14, 3, 0);
const s = (id: string) => buildSession({ tabGroupId: id, title: id });
const ids = (list: { session: { tabGroupId: string } }[]) =>
  list.map((e) => e.session.tabGroupId);

describe('withDeleted', () => {
  it('puts the newest first', () => {
    const list = withDeleted(
      withDeleted([], [s('A')], NOW - 10),
      [s('B')],
      NOW
    );
    expect(ids(list)).toEqual(['B', 'A']);
  });

  it('a session deleted again replaces its old entry', () => {
    const list = withDeleted(
      withDeleted([], [s('A')], NOW - 10),
      [s('A')],
      NOW
    );
    expect(list).toHaveLength(1);
    expect(list[0].deletedAt).toBe(NOW);
  });

  it('drops entries past 30 days', () => {
    const list = withDeleted(
      [{ session: s('old'), deletedAt: NOW - TOMBSTONE_TTL_MS - 1 }],
      [s('A')],
      NOW
    );
    expect(ids(list)).toEqual(['A']);
  });

  it('keeps at most 100, dropping the oldest', () => {
    const many = Array.from({ length: RECENTLY_DELETED_MAX }, (_, i) => ({
      session: s(`o${i}`),
      deletedAt: NOW - 1000 - i,
    }));
    const list = withDeleted(many, [s('new')], NOW);
    expect(list).toHaveLength(RECENTLY_DELETED_MAX);
    expect(list[0].session.tabGroupId).toBe('new');
    expect(ids(list)).not.toContain(`o${RECENTLY_DELETED_MAX - 1}`);
  });

  it('stores the session unselected', () => {
    const [entry] = withDeleted([], [{ ...s('A'), isSelected: true }], NOW);
    expect(entry.session.isSelected).toBe(false);
  });
});

describe('shownDeleted', () => {
  it('hides a session that is live again (undo, restore, or sync)', () => {
    const list = withDeleted([], [s('A'), s('B')], NOW);
    expect(ids(shownDeleted(list, new Set(['A']), NOW))).toEqual(['B']);
  });

  it('hides an expired entry even before the next write prunes it', () => {
    const list = [{ session: s('A'), deletedAt: NOW - TOMBSTONE_TTL_MS - 1 }];
    expect(shownDeleted(list, new Set(), NOW)).toEqual([]);
  });
});

describe('deletedSessionsFrom: a malformed stored value', () => {
  it.each([undefined, null, 'x', 3, {}])('reads %p as empty', (value) => {
    expect(deletedSessionsFrom(value)).toEqual([]);
  });

  it('keeps the valid entries of a partly malformed list', () => {
    const good = { session: s('A'), deletedAt: NOW };
    const value = [
      good,
      { session: s('B') },
      { deletedAt: NOW },
      { session: { title: 'no id', windows: [] }, deletedAt: NOW },
      { session: { tabGroupId: 'C' }, deletedAt: NOW },
      { session: s('D'), deletedAt: '2026-10-14' },
      null,
    ];
    expect(deletedSessionsFrom(value)).toEqual([good]);
  });
});

describe('storage', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;
  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  it('records, reads back, and empties', async () => {
    handle = setupChromeFake();
    await recordDeleted([s('A')], NOW);
    await recordDeleted([s('B')], NOW + 1);
    expect(ids(await readDeleted())).toEqual(['B', 'A']);
    await emptyDeleted();
    expect(await readDeleted()).toEqual([]);
    expect(RECENTLY_DELETED_KEY in handle.localArea()).toBe(false);
  });

  it('reads junk as empty, and a record over junk starts a fresh list', async () => {
    handle = setupChromeFake();
    await chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: 'junk' });
    expect(await readDeleted()).toEqual([]);
    await recordDeleted([s('A')], NOW);
    expect(ids(await readDeleted())).toEqual(['A']);
  });

  it('recording nothing writes nothing', async () => {
    handle = setupChromeFake();
    await recordDeleted([], NOW);
    expect(RECENTLY_DELETED_KEY in handle.localArea()).toBe(false);
  });
});
