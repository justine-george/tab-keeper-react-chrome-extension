import { describe, expect, it } from 'vitest';

import {
  liveGroupCarryOut,
  liveTabCarryOut,
  liveWindowCarryOut,
} from '../../components/home/opennow/liveCarryOut';
import type { OpenTab, OpenWindow } from '../../utils/functions/openNow';
import type { RecentTabsOf } from '../../utils/functions/recentTabs';

// KAN-280 Part F (spec O12c). What Open now's rows hand the carry: the live item converted as Save window converts it (Q1 A), and its card (D1 A).
const openTab = (id: number, extra: Partial<OpenTab> = {}): OpenTab => ({
  id,
  windowId: 1,
  title: `(2) Tab ${id}`,
  url: `https://t${id}.test/`,
  favIconUrl: '',
  active: false,
  pinned: false,
  audible: false,
  muted: false,
  groupId: null,
  index: id,
  ...extra,
});
const W1: OpenWindow = {
  id: 1,
  isThisWindow: true,
  state: 'normal',
  incognito: false,
  bounds: { left: 5, top: 6, width: 700, height: 500 },
  tabs: [
    openTab(11, { pinned: true }),
    openTab(12, { groupId: 90 }),
    openTab(13, { groupId: 90 }),
    openTab(14),
  ],
  groups: [{ id: 90, title: 'Research', color: 'green', collapsed: false }],
};
const W2: OpenWindow = {
  ...W1,
  id: 2,
  isThisWindow: false,
  incognito: true,
  tabs: [openTab(21, { windowId: 2, active: true })],
  groups: [],
};
const noRecent: RecentTabsOf = () => [];

describe('liveCarryOut', () => {
  it('a tab row hands its tab, as Save window would store it, inside the converted window', () => {
    const out = liveTabCarryOut([W1, W2], '12', noRecent);
    if (out === null || out.item.source !== 'live')
      throw new Error('no live item');
    const { pick, window, chromeWindowId } = out.item.live;
    expect(chromeWindowId).toBe(1);
    const tab = window.tabs[1];
    expect(pick).toEqual({
      kind: 'tab',
      windowId: window.windowId,
      tabId: tab.tabId,
    });
    expect(tab).toMatchObject({ title: 'Tab 12', url: 'https://t12.test/' });
    expect(tab.chromeGroupId).toBe(window.chromeTabGroups?.[0].groupId);
    expect(out.card).toEqual({
      kind: 'tab',
      title: 'Tab 12',
      faviconUrl: expect.any(String),
    });
  });

  it('a group row hands its group, its card coloured and counted', () => {
    const out = liveGroupCarryOut([W1], 'group:90', noRecent);
    if (out === null || out.item.source !== 'live')
      throw new Error('no live item');
    const w = out.item.live.window;
    expect(out.item.live.pick).toEqual({
      kind: 'group',
      windowId: w.windowId,
      groupId: w.chromeTabGroups?.[0].groupId,
    });
    expect(out.card).toMatchObject({
      kind: 'group',
      title: 'Research',
      tabCount: 2,
    });
  });

  it('a window row hands its window, numbered as Open now numbers it, its incognito mark kept', () => {
    const out = liveWindowCarryOut([W1, W2], '2', () => 2, noRecent);
    if (out === null || out.item.source !== 'live')
      throw new Error('no live item');
    expect(out.item.live.window.incognito).toBe(true);
    expect(out.item.live.chromeWindowId).toBe(2);
    expect(out.card).toEqual({
      kind: 'window',
      title: '',
      number: 2,
      tabCount: 1,
    });
  });

  it("This window's active tab is the one its recent record names (KAN-458 A4)", () => {
    const out = liveWindowCarryOut(
      [W1],
      '1',
      () => 1,
      () => [13]
    );
    if (out === null || out.item.source !== 'live')
      throw new Error('no live item');
    const w = out.item.live.window;
    expect(w.activeTabId).toBe(w.tabs[2].tabId);
  });

  it('each pick-up is its own snapshot: fresh ids, so two copies are two', () => {
    const a = liveTabCarryOut([W1], '14', noRecent);
    const b = liveTabCarryOut([W1], '14', noRecent);
    if (a?.item.source !== 'live' || b?.item.source !== 'live')
      throw new Error('no live item');
    expect(a.item.live.window.windowId).not.toBe(b.item.live.window.windowId);
  });

  it('an id no window lists hands nothing', () => {
    expect(liveTabCarryOut([W1], '99', noRecent)).toBeNull();
    expect(liveGroupCarryOut([W1], 'group:77', noRecent)).toBeNull();
    expect(liveGroupCarryOut([W1], '12', noRecent)).toBeNull();
    expect(liveWindowCarryOut([W1], '9', () => 1, noRecent)).toBeNull();
  });
});
