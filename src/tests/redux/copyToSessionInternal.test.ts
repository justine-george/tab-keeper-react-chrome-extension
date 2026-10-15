import { beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import { v5 as uuidv5 } from 'uuid';

import reducer, {
  copyToSessionInternal,
  replaceState,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { CarriedPick } from '../../redux/carriedItem';
import {
  T0,
  container,
  s1,
  s3,
  session,
  sessionIds,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';
import {
  LIVE_BOUNDS,
  live,
  liveTab,
  snapshotWindow,
} from '../fixtures/liveSnapshotFixture';

// KAN-280 Part F (spec O12c, O13). A copy of a live item lands where a move would, and removes nothing.
const NS = '6f1c5d0e-6d3c-4b6e-9a51-3f0c2b7f9a10';
const NOW = T0 + 5_000;
const base = (c = container()): TabMasterContainer =>
  reducer(undefined, replaceState(c));
type TabPick = Extract<CarriedPick, { kind: 'tab' }>;
const L1: TabPick = { kind: 'tab', windowId: 'live-w', tabId: 'l1' };
const LP: TabPick = { kind: 'tab', windowId: 'live-w', tabId: 'lp' };
const LG: Extract<CarriedPick, { kind: 'group' }> = {
  kind: 'group',
  windowId: 'live-w',
  groupId: 'lg',
};
const LW: Extract<CarriedPick, { kind: 'window' }> = {
  kind: 'window',
  windowId: 'live-w',
};

beforeEach(() => localStorage.clear());

describe('copyToSessionInternal: every landing (spec O12c, O13)', () => {
  it('a tab at an exact spot lands there, loose, and only the target is stamped', () => {
    const before = base();
    const after = reducer(
      before,
      copyToSessionInternal(
        { pick: L1, to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 1 } },
        live(),
        NS,
        NOW
      )
    );
    expect(tabIds(windowIn(after, 'S2', 'd1'))).toEqual([
      'u1',
      'l1',
      'u2',
      'u3',
    ]);
    expect(windowIn(after, 'S2', 'd1').tabs[1]).toEqual({
      tabId: 'l1',
      favicon: '',
      title: 'Live l1',
      url: 'https://l1.test/',
    });
    expect(windowIn(after, 'S2', 'd1').tabCount).toBe(4);
    expect(sessionIn(after, 'S2').tabCount).toBe(5);
    expect(sessionIn(after, 'S2').contentModified).toBe(NOW);
    expect(sessionIds(after)[0]).toBe('S2');
    expect(sessionIn(after, 'S1')).toEqual(sessionIn(before, 'S1'));
    expect(sessionIn(after, 'S3')).toEqual(sessionIn(before, 'S3'));
  });

  it('a tab released in a band joins it', () => {
    const after = reducer(
      base(),
      copyToSessionInternal(
        {
          pick: L1,
          to: {
            tabGroupId: 'S2',
            windowId: 'd1',
            toIndex: 2,
            toChromeGroupId: 'h1',
          },
        },
        live(),
        NS,
        NOW
      )
    );
    expect(windowIn(after, 'S2', 'd1').tabs[2]).toMatchObject({
      tabId: 'l1',
      chromeGroupId: 'h1',
    });
  });

  it('a pinned tab stays pinned in the pinned slot, and unpins below it (KAN-458)', () => {
    const first = reducer(
      base(),
      copyToSessionInternal(
        { pick: LP, to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 } },
        live(),
        NS,
        NOW
      )
    );
    expect(windowIn(first, 'S2', 'd1').tabs[0]).toMatchObject({
      tabId: 'lp',
      pinned: true,
    });
    const lower = reducer(
      base(),
      copyToSessionInternal(
        { pick: LP, to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 2 } },
        live(),
        NS,
        NOW
      )
    );
    expect(windowIn(lower, 'S2', 'd1').tabs[2].pinned).toBeUndefined();
  });

  it("a new first window takes the snapshot's bounds, no title, no state", () => {
    const after = reducer(
      base(),
      copyToSessionInternal(
        { pick: L1, to: { tabGroupId: 'S2', newWindowId: 'nw', at: 'first' } },
        live(),
        NS,
        NOW
      )
    );
    const nw = sessionIn(after, 'S2').windows[0];
    expect(nw).toEqual({
      windowId: 'nw',
      windowHeight: LIVE_BOUNDS.height,
      windowWidth: LIVE_BOUNDS.width,
      windowOffsetTop: LIVE_BOUNDS.top,
      windowOffsetLeft: LIVE_BOUNDS.left,
      tabCount: 1,
      title: '',
      tabs: [
        {
          tabId: 'l1',
          favicon: '',
          title: 'Live l1',
          url: 'https://l1.test/',
        },
      ],
    });
    expect(sessionIn(after, 'S2').windowCount).toBe(3);
  });

  // KAN-608: whole, lg1's address (u4's) included.
  it('a group lands between items with its entry, fold and every tab', () => {
    const after = reducer(
      base(),
      copyToSessionInternal(
        { pick: LG, to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 1 } },
        live(),
        NS,
        NOW
      )
    );
    expect(tabIds(windowIn(after, 'S2', 'd1'))).toEqual([
      'u1',
      'lg1',
      'lg2',
      'u2',
      'u3',
    ]);
    expect(
      windowIn(after, 'S2', 'd1').chromeTabGroups?.map((g) => g.groupId)
    ).toEqual(['h1', 'lg']);
    expect(windowIn(after, 'S2', 'd1').chromeTabGroups?.[1]).toMatchObject({
      collapsed: true,
      title: 'Live group',
    });
  });

  it('a window lands between windows, keeping place, state and active tab', () => {
    const after = reducer(
      base(),
      copyToSessionInternal(
        { pick: LW, to: { tabGroupId: 'S2', toIndex: 1 } },
        live(),
        NS,
        NOW
      )
    );
    const ids = sessionIn(after, 'S2').windows.map((w) => w.windowId);
    expect(ids).toEqual(['d1', 'live-w', 'd2']);
    const w = windowIn(after, 'S2', 'live-w');
    expect(tabIds(w)).toEqual(['lp', 'l1', 'l1b', 'lg1', 'lg2', 'ldup']);
    expect(w.state).toBe('maximized');
    expect(w.activeTabId).toBe('l1');
    expect(sessionIn(after, 'S2').windowCount).toBe(3);
    expect(sessionIn(after, 'S2').tabCount).toBe(10);
  });

  // P9: the snapshot's ids are minted at pick-up, so the copy lands under them.
  it("lands under the snapshot's ids, and re-mints only an id the target already holds", () => {
    const plain = reducer(
      base(),
      copyToSessionInternal(
        { pick: L1, to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 } },
        live(),
        NS,
        NOW
      )
    );
    expect(tabIds(windowIn(plain, 'S2', 'd2'))).toEqual(['l1', 'u4']);
    const clash = snapshotWindow([liveTab('u4', 'https://new.test/')]);
    const reminted = reducer(
      base(),
      copyToSessionInternal(
        {
          pick: { kind: 'tab', windowId: 'live-w', tabId: 'u4' },
          to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 },
        },
        clash,
        NS,
        NOW
      )
    );
    expect(tabIds(windowIn(reminted, 'S2', 'd2'))).toEqual([
      uuidv5('u4', NS),
      'u4',
    ]);
  });
});

// KAN-608: no duplicate check.
describe('copyToSessionInternal: duplicates land', () => {
  it('a tab whose address the target holds is copied anyway, and stamped', () => {
    const after = reducer(
      base(),
      copyToSessionInternal(
        {
          pick: { kind: 'tab', windowId: 'live-w', tabId: 'ldup' },
          to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
        },
        live(),
        NS,
        NOW
      )
    );
    expect(windowIn(after, 'S2', 'd1').tabs.map((t) => t.url)).toEqual([
      'https://u1.test/',
      'https://u1.test/',
      'https://u2.test/',
      'https://u3.test/',
    ]);
    expect(sessionIn(after, 'S2').contentModified).toBe(NOW);
  });
});

describe('copyToSessionInternal: what it refuses', () => {
  it('a target that is gone: the same state', () => {
    const before = base(container([s3(), s1()]));
    expect(
      reducer(
        before,
        copyToSessionInternal(
          { pick: L1, to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 } },
          live(),
          NS,
          NOW
        )
      )
    ).toBe(before);
  });

  it('an incognito tab never lands in a normal window, nor a normal one in an incognito window (Q2 A)', () => {
    const normal = base();
    expect(
      reducer(
        normal,
        copyToSessionInternal(
          { pick: L1, to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 } },
          live({ incognito: true }),
          NS,
          NOW
        )
      )
    ).toBe(normal);
    const markedS2 = session('S2', 'Target', T0, [
      { ...win('d1', [tab('u1')]), incognito: true },
    ]);
    const marked = base(container([s3(), markedS2, s1()]));
    expect(
      reducer(
        marked,
        copyToSessionInternal(
          { pick: L1, to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 } },
          live(),
          NS,
          NOW
        )
      )
    ).toBe(marked);
  });

  it('an incognito tab as a new window keeps the mark, and into an incognito window lands', () => {
    const asNew = reducer(
      base(),
      copyToSessionInternal(
        { pick: L1, to: { tabGroupId: 'S2', newWindowId: 'nw', at: 'first' } },
        live({ incognito: true }),
        NS,
        NOW
      )
    );
    expect(sessionIn(asNew, 'S2').windows[0].incognito).toBe(true);
    const markedS2 = session('S2', 'Target', T0, [
      { ...win('d1', [tab('u1')]), incognito: true },
    ]);
    const into = reducer(
      base(container([s3(), markedS2, s1()])),
      copyToSessionInternal(
        { pick: L1, to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 1 } },
        live({ incognito: true }),
        NS,
        NOW
      )
    );
    expect(tabIds(windowIn(into, 'S2', 'd1'))).toEqual(['u1', 'l1']);
  });
});
