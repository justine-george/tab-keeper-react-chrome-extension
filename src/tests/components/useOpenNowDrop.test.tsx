import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

// Spied, not replaced: the real moves still run against the fake, so a test
// can prove both that a refused drop never reached them and that an accepted
// one did what Chrome does.
vi.mock('../../utils/functions/openNowMoves', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/functions/openNowMoves')>();
  return {
    ...actual,
    moveOpenTab: vi.fn(actual.moveOpenTab),
    moveOpenGroup: vi.fn(actual.moveOpenGroup),
  };
});

import {
  openDragWindows,
  useOpenNowDrop,
} from '../../components/home/opennow/useOpenNowDrop';
import { toOpenWindows } from '../../utils/functions/openNow';
import type { OpenWindow } from '../../utils/functions/openNow';
import { moveOpenGroup, moveOpenTab } from '../../utils/functions/openNowMoves';
import type { MovedTabs } from '../../utils/functions/openNowMoves';
import {
  noteTabKeeperAction,
  takeOpenNowDrop,
} from '../../redux/openNowMoveUndo';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../setup/chrome.fake';

// KAN-280 Part E, Task 6c. What an Open now drag MEANS, apart from how the
// engine drives it: the windows as the drop geometry reads them, where a held
// row may land in a window (landingRange, O11c), which windows take it at all
// (acceptsWindow: K1, O11d, T1), and that a drop becomes the Chrome calls of
// openNowMoves.ts -- or none, when the geometry describes no move.

let handle: ChromeFakeHandle | undefined;

beforeEach(() => {
  vi.mocked(moveOpenTab).mockClear();
  vi.mocked(moveOpenGroup).mockClear();
});

afterEach(() => {
  cleanup();
  handle?.restore();
  handle = undefined;
  // A drop a test stored is module state: a later action retires it.
  noteTabKeeperAction();
});

// The tab view's own address, which Open now leaves out (the same trick as
// openNowPinned.test.tsx).
function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

const url = (name: string) => `https://${name}.test/`;

// The snapshot is read through toOpenWindows off the fake, never hand-built,
// so every shape here is one the pane's real read produces. Without the grant
// the read asks for no groups, as useOpenWindows does.
async function snapshot(hasTabGroups: boolean): Promise<OpenWindow[]> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups =
    hasTabGroups && chrome.tabGroups ? await chrome.tabGroups.query({}) : null;
  return toOpenWindows(all, groups, null);
}

async function install(seed: ChromeSeed, hasTabGroups = true) {
  handle = setupChromeFake(seed);
  return snapshot(hasTabGroups);
}

function renderDrop(
  windows: readonly OpenWindow[],
  options: {
    hasTabGroups?: boolean;
    collapsedIds?: ReadonlySet<number>;
    onMoved?: (moved: MovedTabs) => void;
  } = {}
) {
  return renderHook(() =>
    useOpenNowDrop({
      windows,
      hasTabGroups: options.hasTabGroups ?? true,
      collapsedIds: options.collapsedIds ?? new Set(),
      onMoved: options.onMoved,
    })
  );
}

// W1: two pinned tabs, then two unpinned. W2: a loose tab and group 50 (two
// tabs), no pinned tab. W3: every tab pinned. W4: incognito.
const PINNED_A = 11;
const PINNED_B = 12;
const LOOSE_A = 13;
const LOOSE_B = 14;
const LOOSE_C = 21;
const GROUPED_1 = 22;
const GROUPED_2 = 23;
const ALL_PINNED_1 = 31;
const ALL_PINNED_2 = 32;
const INCOGNITO_TAB = 41;
const GROUP = 50;

function fourWindows(extra: Partial<ChromeSeed> = {}): ChromeSeed {
  return {
    windows: [
      {
        id: 1,
        tabs: [
          { id: PINNED_A, url: url('pa'), pinned: true, active: true },
          { id: PINNED_B, url: url('pb'), pinned: true },
          { id: LOOSE_A, url: url('la') },
          { id: LOOSE_B, url: url('lb') },
        ],
      },
      {
        id: 2,
        tabs: [
          { id: LOOSE_C, url: url('lc'), active: true },
          { id: GROUPED_1, url: url('g1'), groupId: GROUP },
          { id: GROUPED_2, url: url('g2'), groupId: GROUP },
        ],
      },
      {
        id: 3,
        tabs: [
          { id: ALL_PINNED_1, url: url('ap1'), pinned: true, active: true },
          { id: ALL_PINNED_2, url: url('ap2'), pinned: true },
        ],
      },
      {
        id: 4,
        incognito: true,
        tabs: [{ id: INCOGNITO_TAB, url: url('in'), active: true }],
      },
    ],
    tabGroups: [{ id: GROUP, title: 'Research', color: 'blue', windowId: 2 }],
    ...extra,
  };
}

const groupItem = `group:${GROUP}`;

describe('openDragWindows: the windows as the drop geometry reads them', () => {
  const seed = (): ChromeSeed => ({
    windows: [
      {
        id: 7,
        tabs: [
          { id: 71, url: url('p'), pinned: true },
          { id: 72, url: url('g1'), groupId: GROUP },
          { id: 73, url: url('g2'), groupId: GROUP },
          { id: 74, url: url('l') },
        ],
      },
    ],
    tabGroups: [{ id: GROUP, title: 'Research', color: 'blue', windowId: 7 }],
  });

  test('ids become strings, pinned is carried, and a grouped tab names its group', async () => {
    const windows = await install(seed());
    expect(openDragWindows(windows, true)).toEqual([
      {
        windowId: '7',
        tabs: [
          { tabId: '71', pinned: true },
          { tabId: '72', pinned: false, chromeGroupId: '50' },
          { tabId: '73', pinned: false, chromeGroupId: '50' },
          { tabId: '74', pinned: false },
        ],
        chromeTabGroups: [{ groupId: '50', title: 'Research', color: 'blue' }],
      },
    ]);
  });

  test('without the grant there are no groups (O11e)', async () => {
    const windows = await install(seed(), false);
    expect(openDragWindows(windows, false)).toEqual([
      {
        windowId: '7',
        tabs: [
          { tabId: '71', pinned: true },
          { tabId: '72', pinned: false },
          { tabId: '73', pinned: false },
          { tabId: '74', pinned: false },
        ],
        chromeTabGroups: [],
      },
    ]);
  });

  // Off the happy path: a snapshot read while the grant was held, handed over
  // after it went. The geometry must not offer bands the pane stops drawing.
  test('a snapshot that still carries groups loses them when the grant is gone', async () => {
    const windows = await install(seed());
    const [window] = openDragWindows(windows, false);
    expect(window?.chromeTabGroups).toEqual([]);
    expect(window?.tabs.some((tab) => tab.chromeGroupId !== undefined)).toBe(
      false
    );
  });
});

describe('landingRange: where a held row may land in a window (O11c)', () => {
  test('a pinned tab lands only among its window’s pinned tabs', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    // W1 with PINNED_A lifted out: one other pinned tab, so 0 or 1.
    expect(result.current.tabs.landingRange(String(PINNED_A), '1')).toEqual({
      min: 0,
      max: 1,
    });
  });

  test('an unpinned tab lands below the pinned run, in its own window and another', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    // W1 with LOOSE_A lifted out: [PA, PB, LB], so from 2 to 3.
    expect(result.current.tabs.landingRange(String(LOOSE_A), '1')).toEqual({
      min: 2,
      max: 3,
    });
    // Into W1 from W2: [PA, PB, LA, LB], so from 2 to 4.
    expect(result.current.tabs.landingRange(String(LOOSE_C), '1')).toEqual({
      min: 2,
      max: 4,
    });
  });

  test('a window with no pinned tabs takes an unpinned tab anywhere', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(result.current.tabs.landingRange(String(LOOSE_A), '2')).toEqual({
      min: 0,
      max: 3,
    });
  });

  test('a window whose tabs are all pinned takes an unpinned tab only at its end', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(result.current.tabs.landingRange(String(LOOSE_A), '3')).toEqual({
      min: 2,
      max: 2,
    });
    // And its own pinned tab anywhere in it.
    expect(result.current.tabs.landingRange(String(ALL_PINNED_1), '3')).toEqual(
      { min: 0, max: 1 }
    );
  });

  test('a group lands below the pinned run, counted in top-level rows', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    // W1's items: PA, PB, LA, LB.
    expect(result.current.items.landingRange(groupItem, '1')).toEqual({
      min: 2,
      max: 4,
    });
    // Its own W2 with the group lifted out: [LC].
    expect(result.current.items.landingRange(groupItem, '2')).toEqual({
      min: 0,
      max: 1,
    });
    expect(result.current.items.landingRange(groupItem, '3')).toEqual({
      min: 2,
      max: 2,
    });
  });

  // Task 5's fix round: the engine bounds the range to the rows a window
  // SHOWS, and a folded window shows none -- it takes only position 0. A min
  // read from Chrome's pinned count there would refuse every drop.
  test('a folded window shows no rows, so it takes position 0 whatever it holds', async () => {
    const { result } = renderDrop(await install(fourWindows()), {
      collapsedIds: new Set([1, 3]),
    });
    expect(result.current.tabs.landingRange(String(LOOSE_C), '1')).toEqual({
      min: 0,
      max: 0,
    });
    expect(result.current.tabs.landingRange(String(LOOSE_C), '3')).toEqual({
      min: 0,
      max: 0,
    });
    expect(result.current.items.landingRange(groupItem, '1')).toEqual({
      min: 0,
      max: 0,
    });
  });
});

describe('acceptsWindow: which windows take a held row at all', () => {
  test('K1: a pinned tab stays in its own window', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(result.current.tabs.acceptsWindow(String(PINNED_A), '1')).toBe(true);
    expect(result.current.tabs.acceptsWindow(String(PINNED_A), '2')).toBe(
      false
    );
  });

  test('by default a tab and a group go to any window of their own profile', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(result.current.tabs.acceptsWindow(String(LOOSE_A), '2')).toBe(true);
    expect(result.current.tabs.acceptsWindow(String(LOOSE_A), '3')).toBe(true);
    expect(result.current.items.acceptsWindow(groupItem, '1')).toBe(true);
    expect(result.current.items.acceptsWindow(groupItem, '2')).toBe(true);
  });

  test('O11d: a normal row is refused by an incognito window', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(result.current.tabs.acceptsWindow(String(LOOSE_A), '4')).toBe(false);
    expect(result.current.items.acceptsWindow(groupItem, '4')).toBe(false);
  });

  test('O11d: an incognito row is refused by a normal window, and kept by its own', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(result.current.tabs.acceptsWindow(String(INCOGNITO_TAB), '1')).toBe(
      false
    );
    expect(result.current.tabs.acceptsWindow(String(INCOGNITO_TAB), '4')).toBe(
      true
    );
  });

  // T1 (spec O11h). The page this pane is on is left out of the list, but it
  // can sit in a Chrome group -- here, group 50, between LC and G1.
  const tabViewInGroup = (): ChromeSeed => {
    const seed = fourWindows({ currentTabId: 20 });
    seed.windows?.[1]?.tabs?.splice(1, 0, {
      id: 20,
      url: tabViewUrl(),
      groupId: GROUP,
    });
    return seed;
  };

  test('T1: a group holding this page stays in its own window', async () => {
    const { result } = renderDrop(await install(tabViewInGroup()));
    await waitFor(() =>
      expect(result.current.items.acceptsWindow(groupItem, '1')).toBe(false)
    );
    expect(result.current.items.acceptsWindow(groupItem, '2')).toBe(true);
    // Only the group: a tab of it may still leave on its own.
    expect(result.current.tabs.acceptsWindow(String(GROUPED_1), '1')).toBe(
      true
    );
  });

  test('T1: with this page outside the group, the group may leave', async () => {
    const seed = fourWindows({ currentTabId: 20 });
    seed.windows?.[1]?.tabs?.push({ id: 20, url: tabViewUrl() });
    const { result } = renderDrop(await install(seed));
    // Read settled before asserting, so a pass is not the read still being
    // in flight: getCurrent answers on the next tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.items.acceptsWindow(groupItem, '1')).toBe(true);
  });

  test('T1: in the popup there is no page tab, and the group may leave', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.items.acceptsWindow(groupItem, '1')).toBe(true);
  });

  // The page's group is read again with each snapshot: it can be grouped
  // after the pane opened.
  test('T1: the page joining the group later is seen at the next snapshot', async () => {
    const seed = fourWindows({ currentTabId: 20 });
    seed.windows?.[1]?.tabs?.push({ id: 20, url: tabViewUrl() });
    const first = await install(seed);
    const { result, rerender } = renderHook(
      ({ windows }: { windows: readonly OpenWindow[] }) =>
        useOpenNowDrop({
          windows,
          hasTabGroups: true,
          collapsedIds: new Set(),
        }),
      { initialProps: { windows: first } }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.items.acceptsWindow(groupItem, '1')).toBe(true);
    await chrome.tabs.group({ groupId: GROUP, tabIds: [20] });
    rerender({ windows: await snapshot(true) });
    await waitFor(() =>
      expect(result.current.items.acceptsWindow(groupItem, '1')).toBe(false)
    );
  });
});

describe('a drop becomes Chrome calls, or none', () => {
  test('a tab drop moves the real tab and hands the record on', async () => {
    const windows = await install(fourWindows());
    const onMoved = vi.fn();
    const { result } = renderDrop(windows, { onMoved });
    // LA from W1 to W2, between LC and the group.
    const moved = await result.current.tabs.onMove(
      String(LOOSE_A),
      1,
      undefined,
      '2'
    );
    expect(moveOpenTab).toHaveBeenCalledWith(
      {
        tabId: String(LOOSE_A),
        fromWindowId: '1',
        toWindowId: '2',
        toIndex: 1,
        toGroupId: undefined,
      },
      windows,
      true
    );
    const tab = await chrome.tabs.get(LOOSE_A);
    expect([tab.windowId, tab.index]).toEqual([2, 1]);
    expect(moved).not.toBeNull();
    expect(onMoved).toHaveBeenCalledWith(moved);
  });

  test('without the grant the move is made without groups', async () => {
    const windows = await install(fourWindows(), false);
    const { result } = renderDrop(windows, { hasTabGroups: false });
    await result.current.tabs.onMove(String(LOOSE_A), 0, undefined, '2');
    expect(moveOpenTab).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: String(LOOSE_A) }),
      windows,
      false
    );
  });

  test('a group drop moves the real group and hands the record on', async () => {
    const windows = await install(fourWindows());
    const onMoved = vi.fn();
    const { result } = renderDrop(windows, { onMoved });
    const moved = await result.current.items.onMove(
      groupItem,
      2,
      undefined,
      '1'
    );
    expect(moveOpenGroup).toHaveBeenCalledWith(
      {
        groupId: String(GROUP),
        fromWindowId: '2',
        toWindowId: '1',
        toIndex: 2,
      },
      windows
    );
    const tab = await chrome.tabs.get(GROUPED_1);
    expect([tab.windowId, tab.index, tab.groupId]).toEqual([1, 2, GROUP]);
    expect(onMoved).toHaveBeenCalledWith(moved);
  });

  // Task 4's refusal paths, each of which Open now's callers can reach: the
  // geometry describes no move, and nothing is asked of Chrome.
  test('a tab the snapshot does not hold calls nothing', async () => {
    const onMoved = vi.fn();
    const { result } = renderDrop(await install(fourWindows()), { onMoved });
    expect(await result.current.tabs.onMove('999', 0, undefined, '1')).toBe(
      null
    );
    expect(moveOpenTab).not.toHaveBeenCalled();
    expect(onMoved).not.toHaveBeenCalled();
  });

  test('a tab drop that names no window calls nothing', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(
      await result.current.tabs.onMove(String(LOOSE_A), 0, undefined, undefined)
    ).toBe(null);
    expect(moveOpenTab).not.toHaveBeenCalled();
  });

  // Chrome numbers tabs and groups separately, so a tab can carry the same
  // number as a group: its item id must still not be read as that group.
  test('a loose tab’s item id in the group list calls nothing, even when a group shares its number', async () => {
    const seed = fourWindows();
    seed.windows?.[0]?.tabs?.push({ id: GROUP, url: url('same-number') });
    const { result } = renderDrop(await install(seed));
    expect(
      await result.current.items.onMove(`tab:${GROUP}`, 0, undefined, '1')
    ).toBe(null);
    expect(
      await result.current.items.onMove(`tab:${LOOSE_A}`, 0, undefined, '2')
    ).toBe(null);
    expect(moveOpenGroup).not.toHaveBeenCalled();
    expect(moveOpenTab).not.toHaveBeenCalled();
  });

  test('a group no window holds, or a group drop that names no window, calls nothing', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(
      await result.current.items.onMove('group:77', 0, undefined, '1')
    ).toBe(null);
    expect(
      await result.current.items.onMove(groupItem, 0, undefined, undefined)
    ).toBe(null);
    expect(moveOpenGroup).not.toHaveBeenCalled();
  });

  // Off the happy path: Chrome refuses (the tab closed during the hold). The
  // hook passes the refusal on as null and records nothing.
  test('a move Chrome refuses hands no record on', async () => {
    const windows = await install(fourWindows());
    const onMoved = vi.fn();
    const { result } = renderDrop(windows, { onMoved });
    await chrome.tabs.remove(LOOSE_A);
    expect(
      await result.current.tabs.onMove(String(LOOSE_A), 0, undefined, '2')
    ).toBe(null);
    expect(moveOpenTab).toHaveBeenCalled();
    expect(onMoved).not.toHaveBeenCalled();
  });
});

// Spec O11f, ledger R23: a drop that changed something is what ⌘Z undoes
// next; a drop in place is not an action at all.
describe('a drop is kept for ⌘Z', () => {
  test('a tab drop that moved the tab, as a tab drop', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    const moved = await result.current.tabs.onMove(
      String(LOOSE_A),
      1,
      undefined,
      '2'
    );
    if (moved === null) throw new Error('PREMISE: the drop was refused');

    expect(takeOpenNowDrop()).toEqual({ kind: 'tab', moved });
  });

  test('a group drop, as a group drop', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    const moved = await result.current.items.onMove(
      groupItem,
      2,
      undefined,
      '1'
    );
    if (moved === null) throw new Error('PREMISE: the drop was refused');

    expect(takeOpenNowDrop()).toEqual({ kind: 'group', moved });
  });

  test('a drop in place is neither kept nor an action: the drop before it is still the one ⌘Z undoes', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    const earlier = await result.current.tabs.onMove(
      String(LOOSE_A),
      1,
      undefined,
      '2'
    );
    if (earlier === null) throw new Error('PREMISE: the drop was refused');
    // AP2 where it stands, in a window the first drop left alone.
    const inPlace = await result.current.tabs.onMove(
      String(ALL_PINNED_2),
      1,
      undefined,
      '3'
    );
    // PREMISE: Chrome was asked, and nothing changed.
    expect(inPlace).not.toBeNull();
    expect(
      inPlace?.every(({ before, after }) => before.index === after.index)
    ).toBe(true);

    expect(takeOpenNowDrop()).toEqual({ kind: 'tab', moved: earlier });
  });
});
