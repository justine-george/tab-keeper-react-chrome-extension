import { describe, expect, test } from 'vitest';

import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-141. The merge orders sessions by `rank ?? contentInstant` -- moved off
// createdInstant, so the list is "recently changed first" rather than
// "recently created first".
//
// TWO DEVICES, NOT ONE. A fixture where the cloud is this device's own state
// echoed back cannot see data loss or divergence: both sides agree by
// construction. KAN-80 shipped and was reverted for exactly that. So every case
// here builds a LOCAL and a CLOUD that genuinely differ, and asserts what a
// device ends up with after merging them.
//
// The property that matters most is not any particular order. It is that both
// devices compute the SAME order from the same data -- an ordering key that
// disagreed across devices would leave two clients fighting, each re-writing
// what the other just synced.

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

const session = (
  id: string,
  createdAt: number,
  overrides: Partial<tabContainerData> = {}
): tabContainerData =>
  ({
    tabGroupId: id,
    title: id.toUpperCase(),
    createdTime: '2026-09-09 12:00:00',
    createdAt,
    lastModified: createdAt,
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: `${id}-w`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 'Window',
        tabs: [
          { tabId: `${id}-t`, favicon: '', title: 'Tab', url: 'https://a.co' },
        ],
      },
    ],
    ...overrides,
  }) as tabContainerData;

const container = (groups: tabContainerData[]): TabMasterContainer => ({
  lastModified: Math.max(...groups.map((g) => g.lastModified ?? 0), 1),
  selectedTabGroupId: groups[0]?.tabGroupId ?? null,
  tabGroups: groups,
});

// `now` is injected into the merge rather than read from the clock, so
// tombstone collection is deterministic; it is far past every fixture instant
// here so nothing is garbage-collected mid-test.
const NOW = T0 + 24 * HOUR;

const mergedIds = (
  local: TabMasterContainer,
  cloud: TabMasterContainer
): string[] =>
  mergeTabContainers(local, cloud, NOW).merged.tabGroups.map(
    (g) => g.tabGroupId
  );

describe('the merge orders by when a session last changed', () => {
  test('an edited session outranks a newer one that was never touched', () => {
    // `a` is the OLDER session by creation, so under the previous key it sorted
    // last. It has since been edited, and `b` has not.
    const local = container([
      session('b', T0),
      session('a', T0 - 2 * HOUR, {
        contentModified: T0 + HOUR,
        lastModified: T0 + HOUR,
      }),
    ]);
    const cloud = container([session('b', T0), session('a', T0 - 2 * HOUR)]);

    expect(mergedIds(local, cloud)).toEqual(['a', 'b']);
  });

  // THE CONVERGENCE PROPERTY, and the one a broken ordering key breaks first.
  // Both devices hold the same two sessions and merge in opposite directions;
  // if the key were not a pure function of the data, they would disagree and
  // each would keep overwriting the other.
  test('both devices reach the same order from opposite directions', () => {
    const laptop = container([
      session('a', T0 - 2 * HOUR, { contentModified: T0 + HOUR }),
      session('b', T0),
    ]);
    const desktop = container([
      session('b', T0),
      session('a', T0 - 2 * HOUR, { contentModified: T0 + HOUR }),
    ]);

    expect(mergedIds(laptop, desktop)).toEqual(mergedIds(desktop, laptop));
  });

  // NO MIGRATION. A session written before contentModified existed has none,
  // and must sort exactly where it sorts today -- on createdInstant. Both
  // formats coexist for real: extensions update per device, so an old client
  // and a new one write into the same document for as long as it takes the
  // slower one to update.
  test('a session with no contentModified sorts on its creation instant', () => {
    const legacy = session('old', T0);
    const edited = session('new', T0 - 2 * HOUR, {
      contentModified: T0 - HOUR,
    });

    // T0 beats T0 - HOUR, so the unmigrated session is still first.
    expect(
      mergedIds(container([legacy, edited]), container([legacy, edited]))
    ).toEqual(['old', 'new']);
  });

  test('an unmigrated list merges byte-identically to how it always did', () => {
    const a = session('a', T0 - 2 * HOUR);
    const b = session('b', T0 - HOUR);
    const c = session('c', T0);

    expect(mergedIds(container([c, b, a]), container([c, b, a]))).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  // A rank still wins, because an explicit sort or drag is the user saying
  // where a session goes -- and that has to outrank "it changed recently", or
  // editing a session would silently undo the order they arranged.
  test('an explicit rank outranks a more recent edit', () => {
    const local = container([
      session('a', T0 - 2 * HOUR, { rank: T0 + 10 * HOUR }),
      session('b', T0, { contentModified: T0 + HOUR }),
    ]);

    expect(mergedIds(local, local)).toEqual(['a', 'b']);
  });

  // Equal keys must still produce ONE order, or two devices could sort the same
  // data differently and never converge. Two sessions saved in the same
  // millisecond is not hypothetical -- it is what every test fixture that seeds
  // a list in one tick produces.
  test('sessions that tie are broken by id, so the order is total', () => {
    const tie = [session('b', T0), session('a', T0)];

    const forward = mergedIds(container(tie), container(tie));
    const backward = mergedIds(
      container([...tie].reverse()),
      container([...tie].reverse())
    );

    expect(forward).toEqual(backward);
  });
});
