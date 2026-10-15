import { describe, expect, it } from 'vitest';

import { tabsToCopy, windowToCopy } from '../../../utils/functions/liveCopy';
import {
  live,
  liveTab,
  snapshotWindow,
} from '../../fixtures/liveSnapshotFixture';

// KAN-280 Part F (O13), KAN-608: what a copy of a live item lands. Everything picked, duplicates included.
describe('liveCopy: what a copy lands', () => {
  it('a single tab leaves its group and its split, and is not the snapshot object', () => {
    const snapshot = live();
    const planned = tabsToCopy(snapshot, {
      kind: 'tab',
      windowId: 'live-w',
      tabId: 'l1',
    });
    expect(planned?.group).toBeUndefined();
    expect(planned?.tabs).toEqual([
      { tabId: 'l1', favicon: '', title: 'Live l1', url: 'https://l1.test/' },
    ]);
    expect(planned?.tabs[0]).not.toBe(snapshot.tabs[1]);
  });

  it('a group keeps its entry, fold included, and every tab', () => {
    const planned = tabsToCopy(live(), {
      kind: 'group',
      windowId: 'live-w',
      groupId: 'lg',
    });
    expect(planned?.tabs.map((t) => t.tabId)).toEqual(['lg1', 'lg2']);
    expect(planned?.group).toEqual({
      groupId: 'lg',
      title: 'Live group',
      color: 'red',
      collapsed: true,
    });
  });

  it('a window keeps its place, state, active tab, splits and groups, every tab', () => {
    const w = windowToCopy(live());
    expect(w?.tabs.map((t) => t.tabId)).toEqual([
      'lp',
      'l1',
      'l1b',
      'lg1',
      'lg2',
      'ldup',
    ]);
    expect(w?.tabCount).toBe(6);
    expect(w?.activeTabId).toBe('l1');
    expect(w?.state).toBe('maximized');
    expect(w?.tabs[1].splitId).toBe('sp');
    expect(w?.chromeTabGroups?.map((g) => g.groupId)).toEqual(['lg']);
  });

  it('a window is fresh objects, never the snapshot', () => {
    const snapshot = live();
    const w = windowToCopy(snapshot);
    expect(w).not.toBe(snapshot);
    expect(w?.tabs[0]).not.toBe(snapshot.tabs[0]);
    expect(w?.chromeTabGroups?.[0]).not.toBe(snapshot.chromeTabGroups?.[0]);
  });

  it('duplicates inside the carried item are kept', () => {
    const twice = snapshotWindow([
      liveTab('a', 'https://x.test/'),
      liveTab('b', 'https://x.test/'),
    ]);
    expect(windowToCopy(twice)?.tabs.map((t) => t.tabId)).toEqual(['a', 'b']);
  });

  it('a pick the snapshot lacks, or an empty window, lands nothing', () => {
    expect(
      tabsToCopy(live(), { kind: 'tab', windowId: 'live-w', tabId: 'nope' })
    ).toBeNull();
    expect(
      tabsToCopy(live(), { kind: 'group', windowId: 'live-w', groupId: 'nope' })
    ).toBeNull();
    expect(windowToCopy(snapshotWindow([]))).toBeNull();
  });
});
