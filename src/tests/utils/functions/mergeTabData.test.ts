import { describe, it, expect } from 'vitest';

import {
  mergeTabContainers,
  TOMBSTONE_MAX,
  TOMBSTONE_TTL_MS,
} from '../../../utils/functions/mergeTabData';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../../../redux/slices/tabContainerDataStateSlice';

// No DOM stub anywhere in this file, and that absence IS an assertion: the
// merge module must stay importable under vitest's node environment.
//
// Note what this does and does not catch. Merely rewriting mergeTabData's
// `import type` as a plain `import` is invisible here, because esbuild elides
// imports whose bindings are only used as types. What it does catch is the
// change that actually matters - a slice export used as a runtime value -
// which drags in common.ts and fails every test below with
// `ReferenceError: window is not defined`. Confirmed by doing exactly that.
// Do not add stubDomGlobals() to this file to "fix" such a failure; it is the
// warning working.

const NOW = 1_000_000;

function group(id: string, lastModified?: number): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: `w-${id}`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 't',
        tabs: [
          { tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co' },
        ],
      },
    ],
    ...(lastModified === undefined ? {} : { lastModified }),
  };
}

function container(
  lastModified: number,
  tabGroups: tabContainerData[],
  selectedTabGroupId: string | null = null
): TabMasterContainer {
  return { lastModified, selectedTabGroupId, tabGroups };
}

const ids = (c: TabMasterContainer) => c.tabGroups.map((g) => g.tabGroupId);

describe('mergeTabContainers - union and per-session LWW', () => {
  it('keeps a session that exists only on the local side', () => {
    const local = container(10, [group('a', 10)]);
    const cloud = container(20, [group('b', 20)]);
    expect(ids(mergeTabContainers(local, cloud, NOW).merged).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps a session that exists only on the cloud side', () => {
    const local = container(20, [group('b', 20)]);
    const cloud = container(10, [group('a', 10)]);
    expect(ids(mergeTabContainers(local, cloud, NOW).merged).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('takes the newer version when both sides edited the same session', () => {
    const localA = { ...group('a', 50), title: 'LOCAL' };
    const cloudA = { ...group('a', 99), title: 'CLOUD' };
    const { merged } = mergeTabContainers(
      container(50, [localA]),
      container(99, [cloudA]),
      NOW
    );
    expect(merged.tabGroups).toHaveLength(1);
    expect(merged.tabGroups[0].title).toBe('CLOUD');
  });

  it('takes local when local is newer', () => {
    const localA = { ...group('a', 99), title: 'LOCAL' };
    const cloudA = { ...group('a', 50), title: 'CLOUD' };
    const { merged } = mergeTabContainers(
      container(99, [localA]),
      container(50, [cloudA]),
      NOW
    );
    expect(merged.tabGroups[0].title).toBe('LOCAL');
  });

  it('gives an exact tie to cloud, so two devices converge', () => {
    const localA = { ...group('a', 77), title: 'LOCAL' };
    const cloudA = { ...group('a', 77), title: 'CLOUD' };
    const { merged } = mergeTabContainers(
      container(77, [localA]),
      container(77, [cloudA]),
      NOW
    );
    expect(merged.tabGroups[0].title).toBe('CLOUD');
  });

  it('falls back to the container timestamp for pre-migration sessions', () => {
    // neither side has per-session timestamps
    const local = container(10, [group('a'), group('shared')]);
    const cloud = container(20, [
      { ...group('shared'), title: 'CLOUD' },
      group('b'),
    ]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    expect(ids(merged).sort()).toEqual(['a', 'b', 'shared']);
    // cloud container is newer (20 > 10), so its version of `shared` wins
    expect(merged.tabGroups.find((g) => g.tabGroupId === 'shared')!.title).toBe(
      'CLOUD'
    );
  });

  it('handles one migrated side and one not', () => {
    const local = container(10, [{ ...group('a', 999), title: 'LOCAL' }]);
    const cloud = container(20, [{ ...group('a'), title: 'CLOUD' }]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    // local's explicit 999 beats cloud's inherited 20
    expect(merged.tabGroups[0].title).toBe('LOCAL');
  });

  it('survives an empty local side', () => {
    const { merged } = mergeTabContainers(
      container(10, []),
      container(20, [group('a', 20)]),
      NOW
    );
    expect(ids(merged)).toEqual(['a']);
  });

  it('survives an empty cloud side', () => {
    const { merged } = mergeTabContainers(
      container(20, [group('a', 20)]),
      container(10, []),
      NOW
    );
    expect(ids(merged)).toEqual(['a']);
  });

  it('normalizes every surviving session to carry a lastModified', () => {
    const { merged } = mergeTabContainers(
      container(10, [group('a')]),
      container(20, [group('b')]),
      NOW
    );
    expect(
      merged.tabGroups.every((g) => typeof g.lastModified === 'number')
    ).toBe(true);
  });

  it('takes the max container timestamp, never `now`', () => {
    const { merged } = mergeTabContainers(
      container(10, []),
      container(20, []),
      NOW
    );
    expect(merged.lastModified).toBe(20);
  });

  // Ordered by createdTime, which is the date the UI actually displays.
  // Sorting by lastModified instead put a renamed session at the top of the
  // list above sessions showing visibly newer dates.
  it('sorts newest first by the date shown in the UI', () => {
    const dated = (id: string, createdTime: string, lastModified: number) => ({
      ...group(id, lastModified),
      createdTime,
    });
    const { merged } = mergeTabContainers(
      container(30, [
        dated('old', '2026-08-01 00:00:00', 1),
        dated('new', '2026-08-30 00:00:00', 30),
      ]),
      container(20, [dated('mid', '2026-08-20 00:00:00', 20)]),
      NOW
    );
    expect(ids(merged)).toEqual(['new', 'mid', 'old']);
  });

  it('does not move a renamed session above visibly newer ones', () => {
    // Renaming bumps lastModified but deliberately not createdTime, so an
    // edit to the oldest session must not send it to the top of the list.
    const dated = (id: string, createdTime: string, lastModified: number) => ({
      ...group(id, lastModified),
      createdTime,
    });
    const sides = (oldestLastModified: number) =>
      container(5000, [
        dated('A', '2026-08-30 10:00:00', 1000),
        dated('B', '2026-08-29 10:00:00', 900),
        dated('C', '2026-08-01 09:00:00', oldestLastModified),
      ]);

    // C is the oldest session and has just been renamed on this device
    const { merged } = mergeTabContainers(sides(9999), sides(800), NOW);
    expect(ids(merged)).toEqual(['A', 'B', 'C']);
  });

  it('orders identical createdTimes deterministically, without locale', () => {
    // Two devices must agree on the order, so the tiebreak cannot depend on
    // localeCompare, whose result varies by the device's locale.
    const same = (id: string) => ({
      ...group(id, 100),
      createdTime: '2026-08-31 00:00:00',
    });
    const first = mergeTabContainers(
      container(10, [same('b'), same('a')]),
      container(10, [same('c')]),
      NOW
    );
    const second = mergeTabContainers(
      container(10, [same('c')]),
      container(10, [same('a'), same('b')]),
      NOW
    );
    expect(ids(first.merged)).toEqual(['a', 'b', 'c']);
    expect(ids(second.merged)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the local selection when its session survives', () => {
    const { merged } = mergeTabContainers(
      container(30, [group('a', 30)], 'a'),
      container(20, [group('b', 20)], 'b'),
      NOW
    );
    expect(merged.selectedTabGroupId).toBe('a');
    expect(merged.tabGroups.find((g) => g.tabGroupId === 'a')!.isSelected).toBe(
      true
    );
    expect(merged.tabGroups.find((g) => g.tabGroupId === 'b')!.isSelected).toBe(
      false
    );
  });

  it('reports both sides unchanged when they already agree', () => {
    const same = () => container(30, [group('a', 30)], 'a');
    const r = mergeTabContainers(same(), same(), NOW);
    expect(r.changedFromLocal).toBe(false);
    expect(r.changedFromCloud).toBe(false);
  });

  it('reports changedFromCloud when local contributes a session', () => {
    const r = mergeTabContainers(
      container(30, [group('a', 30)]),
      container(20, []),
      NOW
    );
    expect(r.changedFromCloud).toBe(true);
    expect(r.changedFromLocal).toBe(false);
  });

  it('reports changedFromLocal when cloud contributes a session', () => {
    const r = mergeTabContainers(
      container(20, []),
      container(30, [group('a', 30)]),
      NOW
    );
    expect(r.changedFromLocal).toBe(true);
    expect(r.changedFromCloud).toBe(false);
  });
});

describe('mergeTabContainers - tombstones', () => {
  const withTombstones = (
    c: TabMasterContainer,
    t: { tabGroupId: string; deletedAt: number }[]
  ): TabMasterContainer => ({ ...c, deletedTabGroups: t });

  it('a delete on one side removes the session held by the other', () => {
    const local = withTombstones(container(90, []), [
      { tabGroupId: 'a', deletedAt: 90 },
    ]);
    const cloud = container(50, [group('a', 50)]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    expect(ids(merged)).toEqual([]);
    expect(merged.deletedTabGroups).toEqual([
      { tabGroupId: 'a', deletedAt: 90 },
    ]);
  });

  it('an edit later than the delete wins and the session comes back', () => {
    const local = withTombstones(container(50, []), [
      { tabGroupId: 'a', deletedAt: 50 },
    ]);
    const cloud = container(90, [{ ...group('a', 90), title: 'EDITED' }]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    expect(ids(merged)).toEqual(['a']);
    expect(merged.tabGroups[0].title).toBe('EDITED');
    expect(merged.deletedTabGroups ?? []).toEqual([]);
  });

  it('is idempotent - a second round trip does not resurrect', () => {
    const local = withTombstones(container(90, []), [
      { tabGroupId: 'a', deletedAt: 90 },
    ]);
    const cloud = container(50, [group('a', 50)]);
    const once = mergeTabContainers(local, cloud, NOW).merged;
    const twice = mergeTabContainers(once, cloud, NOW).merged;
    expect(ids(twice)).toEqual([]);
    expect(twice.deletedTabGroups).toEqual(once.deletedTabGroups);
  });

  it('drops tombstones older than the TTL', () => {
    const stale = NOW - TOMBSTONE_TTL_MS - 1;
    const local = withTombstones(container(NOW, []), [
      { tabGroupId: 'old', deletedAt: stale },
      { tabGroupId: 'fresh', deletedAt: NOW - 1000 },
    ]);
    const { merged } = mergeTabContainers(local, container(1, []), NOW);
    expect(merged.deletedTabGroups!.map((t) => t.tabGroupId)).toEqual([
      'fresh',
    ]);
  });

  // `now` is injected precisely so the TTL boundary is testable rather than
  // waited for. `<=` is the documented comparison, so a tombstone exactly at
  // the TTL is still live and one millisecond past it is not.
  it('keeps a tombstone sitting exactly on the TTL boundary', () => {
    const local = withTombstones(container(NOW, []), [
      { tabGroupId: 'edge', deletedAt: NOW - TOMBSTONE_TTL_MS },
    ]);
    const { merged } = mergeTabContainers(local, container(1, []), NOW);
    expect(merged.deletedTabGroups!.map((t) => t.tabGroupId)).toEqual(['edge']);
  });

  it('drops a tombstone one millisecond past the TTL', () => {
    const local = withTombstones(container(NOW, []), [
      { tabGroupId: 'edge', deletedAt: NOW - TOMBSTONE_TTL_MS - 1 },
    ]);
    const { merged } = mergeTabContainers(local, container(1, []), NOW);
    expect(merged.deletedTabGroups).toEqual([]);
  });

  // The accepted tradeoff, pinned down so it cannot change silently: once a
  // tombstone expires it stops suppressing the session, so a device that still
  // holds it re-adds it. The failure reappears data; it never loses any.
  it('lets a session return once its tombstone has expired', () => {
    const local = withTombstones(container(NOW, []), [
      { tabGroupId: 'a', deletedAt: NOW - TOMBSTONE_TTL_MS - 1 },
    ]);
    const cloud = container(NOW - 1000, [group('a', NOW - 1000)]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    expect(ids(merged)).toEqual(['a']);
    expect(merged.deletedTabGroups).toEqual([]);
  });

  // The contrast case. Note the session has to be older than the delete for
  // the tombstone to suppress it at all - the TTL governs whether a tombstone
  // is *retained*, not whether it outranks a newer edit. A session edited after
  // the delete legitimately wins however fresh the tombstone is.
  it('still suppresses an older session while the tombstone is inside the TTL', () => {
    const justInside = NOW - TOMBSTONE_TTL_MS + 1;
    const local = withTombstones(container(NOW, []), [
      { tabGroupId: 'a', deletedAt: justInside },
    ]);
    const cloud = container(justInside - 5000, [
      group('a', justInside - 5000), // last touched before it was deleted
    ]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    expect(ids(merged)).toEqual([]);
    expect(merged.deletedTabGroups!.map((t) => t.tabGroupId)).toEqual(['a']);
  });

  it('lets an edit made after the delete win, however fresh the tombstone', () => {
    const local = withTombstones(container(NOW, []), [
      { tabGroupId: 'a', deletedAt: NOW - 10_000 },
    ]);
    const cloud = container(NOW - 1000, [group('a', NOW - 1000)]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    expect(ids(merged)).toEqual(['a']);
    expect(merged.deletedTabGroups).toEqual([]);
  });

  // Exactly at the cap, nothing is dropped - the boundary is inclusive.
  it('keeps exactly TOMBSTONE_MAX tombstones without dropping any', () => {
    const exactly = Array.from({ length: TOMBSTONE_MAX }, (_, i) => ({
      tabGroupId: `g${i}`,
      deletedAt: NOW - i,
    }));
    const local = withTombstones(container(NOW, []), exactly);
    const { merged } = mergeTabContainers(local, container(1, []), NOW);
    expect(merged.deletedTabGroups).toHaveLength(TOMBSTONE_MAX);
  });

  it('drops the oldest when the cap is exceeded, not an arbitrary one', () => {
    const many = Array.from({ length: TOMBSTONE_MAX + 3 }, (_, i) => ({
      tabGroupId: `g${i}`,
      deletedAt: NOW - i, // g0 newest, g502 oldest
    }));
    const local = withTombstones(container(NOW, []), many);
    const { merged } = mergeTabContainers(local, container(1, []), NOW);
    const kept = merged.deletedTabGroups!.map((t) => t.tabGroupId);
    expect(kept).toHaveLength(TOMBSTONE_MAX);
    expect(kept).toContain('g0');
    expect(kept).not.toContain(`g${TOMBSTONE_MAX}`);
    expect(kept).not.toContain(`g${TOMBSTONE_MAX + 2}`);
  });

  it('caps tombstones at TOMBSTONE_MAX, keeping the newest', () => {
    const many = Array.from({ length: TOMBSTONE_MAX + 50 }, (_, i) => ({
      tabGroupId: `g${i}`,
      deletedAt: NOW - i, // g0 newest
    }));
    const local = withTombstones(container(NOW, []), many);
    const { merged } = mergeTabContainers(local, container(1, []), NOW);
    expect(merged.deletedTabGroups).toHaveLength(TOMBSTONE_MAX);
    expect(merged.deletedTabGroups![0].tabGroupId).toBe('g0');
  });
});

// The two flags drive a Firestore write and a toast, so they have to describe
// the document that is actually persisted. collectTombstones drops entries
// past the TTL or beyond the cap, so a signature computed from the unfiltered
// event set claims a difference the written document does not contain - a
// write that changes nothing, repeated on every sync until the stale entry
// finally leaves localStorage.
describe('mergeTabContainers - the flags describe what is written', () => {
  const withTombstones = (
    c: TabMasterContainer,
    t: { tabGroupId: string; deletedAt: number }[]
  ): TabMasterContainer => ({ ...c, deletedTabGroups: t });

  const FAR_FUTURE = 5_000_000_000_000;

  it('does not ask for a write when the only difference is a TTL-dropped tombstone', () => {
    const expired = FAR_FUTURE - TOMBSTONE_TTL_MS - 1;
    const local = withTombstones(container(100, []), [
      { tabGroupId: 'ancient', deletedAt: expired },
    ]);
    const cloud = withTombstones(container(100, []), []);

    const r = mergeTabContainers(local, cloud, FAR_FUTURE);
    expect(r.merged.deletedTabGroups).toEqual([]);
    // merged equals cloud in every persisted respect, so nothing to write
    expect(r.changedFromCloud).toBe(false);
  });

  it('does not ask for a write when the only difference is a capped tombstone', () => {
    const many = Array.from({ length: TOMBSTONE_MAX + 10 }, (_, i) => ({
      tabGroupId: `g${i}`,
      deletedAt: FAR_FUTURE - i,
    }));
    const kept = many.slice(0, TOMBSTONE_MAX);

    const local = withTombstones(container(100, []), many);
    const cloud = withTombstones(container(100, []), kept);

    const r = mergeTabContainers(local, cloud, FAR_FUTURE);
    expect(r.merged.deletedTabGroups).toHaveLength(TOMBSTONE_MAX);
    // cloud already holds exactly the tombstones that survive the cap
    expect(r.changedFromCloud).toBe(false);
  });

  // The converse still has to hold: if the cloud is the side carrying the
  // stale entry, one write is needed to clean it up.
  it('still asks for a write when the cloud holds the expired tombstone', () => {
    const expired = FAR_FUTURE - TOMBSTONE_TTL_MS - 1;
    const local = withTombstones(container(100, []), []);
    const cloud = withTombstones(container(100, []), [
      { tabGroupId: 'ancient', deletedAt: expired },
    ]);

    const r = mergeTabContainers(local, cloud, FAR_FUTURE);
    expect(r.merged.deletedTabGroups).toEqual([]);
    expect(r.changedFromCloud).toBe(true);
  });
});
