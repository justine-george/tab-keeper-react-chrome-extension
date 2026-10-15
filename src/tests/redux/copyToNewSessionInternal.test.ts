import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import reducer, {
  copyToNewSessionInternal,
  replaceState,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { CarriedPick } from '../../redux/carriedItem';
import {
  T0,
  container,
  sessionIds,
  sessionIn,
  tabIds,
} from '../fixtures/sessionMoveFixture';
import { live } from '../fixtures/liveSnapshotFixture';

// KAN-280 Part F (N1 A). A live item let go on the save row: a new session holding its copy.
const NOW = T0 + 9_000;
const minted = {
  tabGroupId: 'NEW',
  newWindowId: 'nw',
  remintNamespace: '6f1c5d0e-6d3c-4b6e-9a51-3f0c2b7f9a10',
  now: NOW,
};
const L1: CarriedPick = { kind: 'tab', windowId: 'live-w', tabId: 'l1' };
const LW: CarriedPick = { kind: 'window', windowId: 'live-w' };
const base = () => reducer(undefined, replaceState(container()));

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('copyToNewSessionInternal (N1 A)', () => {
  it('a tab becomes a new session on top, named by the tab, shown', () => {
    const after = reducer(
      base(),
      copyToNewSessionInternal(L1, live(), 'New Tab Group', '', minted)
    );
    expect(sessionIds(after)[0]).toBe('NEW');
    expect(sessionIn(after, 'NEW').title).toBe('Live l1');
    expect(tabIds(sessionIn(after, 'NEW').windows[0])).toEqual(['l1']);
    expect(sessionIn(after, 'NEW').windows[0].windowId).toBe('nw');
    expect(after.selectedTabGroupId).toBe('NEW');
    expect(sessionIn(after, 'NEW')).toMatchObject({
      windowCount: 1,
      tabCount: 1,
      createdAt: NOW,
    });
  });

  it('a typed name wins, and a window keeps every tab (nothing is there yet)', () => {
    const after = reducer(
      base(),
      copyToNewSessionInternal(LW, live(), 'New Tab Group', '  Trip  ', minted)
    );
    expect(sessionIn(after, 'NEW').title).toBe('Trip');
    expect(tabIds(sessionIn(after, 'NEW').windows[0])).toEqual([
      'lp',
      'l1',
      'l1b',
      'lg1',
      'lg2',
      'ldup',
    ]);
  });

  it('an unnamed window with an untitled first tab takes the fallback', () => {
    const blank = live();
    blank.tabs[0] = { ...blank.tabs[0], title: '' };
    const after = reducer(
      base(),
      copyToNewSessionInternal(LW, blank, 'New Tab Group', '', minted)
    );
    expect(sessionIn(after, 'NEW').title).toBe('New Tab Group');
  });

  it('a pick the snapshot lacks makes no empty session', () => {
    const before = base();
    expect(
      reducer(
        before,
        copyToNewSessionInternal(
          { kind: 'tab', windowId: 'live-w', tabId: 'nope' },
          live(),
          'New Tab Group',
          '',
          minted
        )
      )
    ).toBe(before);
  });
});
