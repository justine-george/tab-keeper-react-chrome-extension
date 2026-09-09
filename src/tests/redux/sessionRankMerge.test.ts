import { describe, expect, test } from 'vitest';

import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-130. The merge orders the session list, so a manual order only survives
// if the merge sorts on it.
//
// The change is deliberately confined to the sort KEY -- `rank ?? createdInstant`
// instead of `createdInstant`. The merge's LOGIC is untouched, because it is
// already session-granular last-writer-wins: a field ON the session is resolved
// correctly with no new rule. That is the whole reason this scope turned out
// cheaper than KAN-130 estimated.

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

const session = (
  id: string,
  createdAt: number,
  extra: Partial<tabContainerData> = {}
): tabContainerData => ({
  tabGroupId: id,
  title: id.toUpperCase(),
  createdTime: '2026-09-09 12:00:00',
  createdAt,
  windowCount: 0,
  tabCount: 0,
  isAutoSave: false,
  isSelected: false,
  windows: [],
  lastModified: createdAt,
  ...extra,
});

const container = (groups: tabContainerData[]): TabMasterContainer => ({
  lastModified: T0,
  selectedTabGroupId: null,
  tabGroups: groups,
  deletedTabGroups: [],
});

const order = (c: TabMasterContainer) => c.tabGroups.map((g) => g.tabGroupId);

describe('the merge orders by rank when one is present', () => {
  test('a ranked session outranks a newer unranked one', () => {
    // `a` is the OLDEST, so newest-first would put it last. A rank above `c`'s
    // createdInstant must lift it to the top.
    const local = container([
      session('c', T0),
      session('b', T0 - HOUR),
      session('a', T0 - 2 * HOUR, { rank: T0 + HOUR }),
    ]);

    const { merged } = mergeTabContainers(local, container([]), T0);

    expect(order(merged)).toEqual(['a', 'c', 'b']);
  });

  test('ranks and createdInstants compare in one space', () => {
    // `b` is ranked BETWEEN c and a's creation instants, so it must land
    // between them -- which only works because both are epoch millis.
    const local = container([
      session('c', T0),
      session('a', T0 - 2 * HOUR),
      session('b', T0 - HOUR, { rank: T0 - HOUR / 2 }),
    ]);

    const { merged } = mergeTabContainers(local, container([]), T0);

    expect(order(merged)).toEqual(['c', 'b', 'a']);
  });

  // THE REGRESSION CONTROL. Every session that exists today has no rank, and
  // this list must come out exactly as it did before the field existed.
  test('CONTROL: a list with no ranks is ordered exactly as before', () => {
    const local = container([
      session('a', T0 - 2 * HOUR),
      session('c', T0),
      session('b', T0 - HOUR),
    ]);

    const { merged } = mergeTabContainers(local, container([]), T0);

    expect(order(merged)).toEqual(['c', 'b', 'a']);
  });

  // The merge's ordering must stay TOTAL and STABLE, because that is what makes
  // two devices agree on the list at all. Equal keys still break on tabGroupId.
  test('equal ranks still break ties deterministically', () => {
    const local = container([
      session('b', T0, { rank: T0 }),
      session('a', T0 - HOUR, { rank: T0 }),
    ]);
    const flipped = container([
      session('a', T0 - HOUR, { rank: T0 }),
      session('b', T0, { rank: T0 }),
    ]);

    const one = mergeTabContainers(local, container([]), T0).merged;
    const two = mergeTabContainers(flipped, container([]), T0).merged;

    expect(order(one)).toEqual(order(two));
  });
});

// The case KAN-130 called "a two-device concurrent-reorder story". It needs no
// new machinery: a rank is a session field, so each device's move is resolved
// by the per-session last-writer-wins the merge already performs.
describe('two devices reordering at once', () => {
  test('converge on the same list from either side', () => {
    // Laptop moved `a` to the top; phone moved `c` to the bottom. Neither
    // touched the other's session.
    const laptop = container([
      session('a', T0 - 2 * HOUR, { rank: T0 + HOUR, lastModified: T0 + 10 }),
      session('c', T0),
      session('b', T0 - HOUR),
    ]);
    const phone = container([
      session('c', T0, { rank: T0 - 3 * HOUR, lastModified: T0 + 20 }),
      session('b', T0 - HOUR),
      session('a', T0 - 2 * HOUR),
    ]);

    const fromLaptop = mergeTabContainers(laptop, phone, T0).merged;
    const fromPhone = mergeTabContainers(phone, laptop, T0).merged;

    // Both devices end up with the same list -- which is the requirement.
    // Convergence, not any particular winner, is what the merge owes here.
    expect(order(fromLaptop)).toEqual(order(fromPhone));
    // And both moves are honoured, because they touched different sessions.
    expect(order(fromLaptop)).toEqual(['a', 'b', 'c']);
  });

  test('the newer edit to the SAME session wins, as everywhere else', () => {
    const laptop = container([
      session('a', T0 - HOUR, { rank: T0 + HOUR, lastModified: T0 + 10 }),
      session('b', T0),
    ]);
    const phone = container([
      session('a', T0 - HOUR, { rank: T0 - 5 * HOUR, lastModified: T0 + 99 }),
      session('b', T0),
    ]);

    const { merged } = mergeTabContainers(laptop, phone, T0);

    // The phone's later rank wins, putting `a` below `b`.
    expect(order(merged)).toEqual(['b', 'a']);
  });
});
