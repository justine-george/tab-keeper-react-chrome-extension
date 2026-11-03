import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load, and showSession reads window.location.search.
const location = vi.hoisted(() => ({ search: '' }));
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
    location,
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  saveToTabContainer,
  type tabContainerData,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setSkipDuplicateTabs } from '../../redux/slices/settingsDataStateSlice';
import type { CarriedPick, LiveSnapshot } from '../../redux/carriedItem';
import { copyToNewSession } from '../../redux/copyToSession';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { buildSession } from '../fixtures/sessionFixture';
import {
  LIVE_GROUP,
  liveTab,
  snapshotWindow,
} from '../fixtures/liveSnapshotFixture';

// KAN-906. A new session keeps one copy of each address when Skip duplicate tabs is on.

const A = 'https://a.test/';
const B = 'https://b.test/';

const sessionOf = (...urls: string[]): tabContainerData => {
  const base = buildSession({ tabGroupId: 'new-1', title: 'Fresh' });
  const tabs = urls.map((url, i) => ({
    tabId: `t${i}`,
    favicon: '',
    title: `T${i}`,
    url,
  }));
  return {
    ...base,
    tabCount: tabs.length,
    windows: [{ ...base.windows[0], tabCount: tabs.length, tabs }],
  };
};

const setup = (on: boolean) => {
  const made = makeTestStore();
  made.store.dispatch(setSkipDuplicateTabs(on));
  return made.store;
};

beforeEach(() => {
  localStorage.clear();
  location.search = '';
});
afterEach(() => localStorage.clear());

describe('saveToTabContainer (KAN-906)', () => {
  it('On: [a, a, b] stores [a, b], and the toast says one was left out', async () => {
    const store = setup(true);
    await store.dispatch(
      saveToTabContainer({
        container: sessionOf(A, A, B),
        scope: 'current-window',
      })
    );
    const [saved] = store.getState().tabContainerDataState.tabGroups;
    expect(saved.windows[0].tabs.map((t) => t.url)).toEqual([A, B]);
    expect(saved.windows[0].tabCount).toBe(2);
    expect(saved.tabCount).toBe(2);
    const [toast] = store.getState().globalState.toasts;
    expect(toast).toMatchObject({
      text: TOAST_MESSAGES.SAVE_CURRENT_WINDOW_SUCCESS,
      leftOut: 1,
    });
  });

  it("Off: [a, a, b] is stored whole, with today's toast", async () => {
    const store = setup(false);
    await store.dispatch(
      saveToTabContainer({
        container: sessionOf(A, A, B),
        scope: 'current-window',
      })
    );
    const [saved] = store.getState().tabContainerDataState.tabGroups;
    expect(saved.windows[0].tabs.map((t) => t.url)).toEqual([A, A, B]);
    expect(saved.tabCount).toBe(3);
    expect(store.getState().globalState.toasts[0].leftOut).toBe(0);
  });

  it('On, nothing repeated: the toast says nothing extra', async () => {
    const store = setup(true);
    await store.dispatch(
      saveToTabContainer({ container: sessionOf(A, B), scope: 'all-windows' })
    );
    expect(store.getState().globalState.toasts[0].leftOut).toBe(0);
  });
});

describe('copyToNewSession (KAN-906)', () => {
  const LG: CarriedPick = { kind: 'group', windowId: 'live-w', groupId: 'lg' };
  const LW: CarriedPick = { kind: 'window', windowId: 'live-w' };
  const LONE: CarriedPick = { kind: 'tab', windowId: 'live-w', tabId: 'x2' };

  const liveOf = (
    pick: CarriedPick,
    window: windowGroupData
  ): LiveSnapshot => ({ pick, window, chromeWindowId: 7 });

  // x1 and x2 share an address with the group's tabs; the group is [g1, g2] both at A.
  const groupWindow = () =>
    snapshotWindow(
      [
        liveTab('x1', A),
        liveTab('g1', A, { chromeGroupId: 'lg' }),
        liveTab('g2', A, { chromeGroupId: 'lg' }),
        liveTab('x2', B),
      ],
      [LIVE_GROUP]
    );

  const newTabs = (store: ReturnType<typeof setup>) => {
    const [first] = store.getState().tabContainerDataState.tabGroups;
    return first.windows.flatMap((w) => w.tabs.map((t) => t.tabId));
  };

  it('On: a group of [a, a] makes a session holding [a], though an unpicked tab also has a', () => {
    const store = setup(true);
    expect(
      store.dispatch(copyToNewSession(liveOf(LG, groupWindow()), 'Fallback'))
    ).toBe(true);
    // x1 (unpicked, earlier in the window, same address) must not knock the group's g1 out.
    expect(newTabs(store)).toEqual(['g1']);
    expect(store.getState().globalState.toasts).toEqual([]);
  });

  it('Off: the same group lands whole', () => {
    const store = setup(false);
    store.dispatch(copyToNewSession(liveOf(LG, groupWindow()), 'Fallback'));
    expect(newTabs(store)).toEqual(['g1', 'g2']);
  });

  it('On: a window drops its repeats and keeps order', () => {
    const store = setup(true);
    store.dispatch(copyToNewSession(liveOf(LW, groupWindow()), 'Fallback'));
    expect(newTabs(store)).toEqual(['x1', 'x2']);
    const [first] = store.getState().tabContainerDataState.tabGroups;
    expect(first.windows[0].chromeTabGroups).toBeUndefined();
    expect(first.tabCount).toBe(2);
  });

  it('On: a lone tab is copied even when the window holds its twin', () => {
    const store = setup(true);
    const window = snapshotWindow([liveTab('x1', B), liveTab('x2', B)]);
    expect(store.dispatch(copyToNewSession(liveOf(LONE, window), 'F'))).toBe(
      true
    );
    expect(newTabs(store)).toEqual(['x2']);
  });

  it('On: a pick that is no longer in the window copies nothing and returns false', () => {
    const store = setup(true);
    const gone: CarriedPick = {
      kind: 'group',
      windowId: 'live-w',
      groupId: 'zz',
    };
    const before = store.getState().tabContainerDataState.tabGroups.length;
    expect(
      store.dispatch(copyToNewSession(liveOf(gone, groupWindow()), 'F'))
    ).toBe(false);
    expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(
      before
    );
  });
});
