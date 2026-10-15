import { describe, expect, it } from 'vitest';

import {
  addressesIn,
  copyOutcome,
  tabsToCopy,
  windowToCopy,
} from '../../../utils/functions/liveCopy';
import { s2, session, tab, win, T0 } from '../../fixtures/sessionMoveFixture';
import {
  live,
  liveTab,
  snapshotWindow,
} from '../../fixtures/liveSnapshotFixture';

const inS2 = () => addressesIn(s2());

describe('liveCopy: what a copy lands (D6 A, O13)', () => {
  it('reads every saved address of the target session, across its windows', () => {
    expect([...inS2()].sort()).toEqual([
      'https://u1.test/',
      'https://u2.test/',
      'https://u3.test/',
      'https://u4.test/',
    ]);
  });

  it('a single tab leaves its group and its split, and is not the snapshot object', () => {
    const snapshot = live();
    const planned = tabsToCopy(
      snapshot,
      { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
      inS2()
    );
    expect(planned.skipped).toBe(0);
    expect(planned.content?.group).toBeUndefined();
    expect(planned.content?.tabs).toEqual([
      { tabId: 'l1', favicon: '', title: 'Live l1', url: 'https://l1.test/' },
    ]);
    expect(planned.content?.tabs[0]).not.toBe(snapshot.tabs[1]);
  });

  it('a tab already in the target is skipped, and nothing is left', () => {
    expect(
      tabsToCopy(
        live(),
        { kind: 'tab', windowId: 'live-w', tabId: 'ldup' },
        inS2()
      )
    ).toEqual({ content: null, skipped: 1 });
  });

  it('a group keeps its entry, fold included, minus the tabs already there', () => {
    const planned = tabsToCopy(
      live(),
      { kind: 'group', windowId: 'live-w', groupId: 'lg' },
      inS2()
    );
    expect(planned.skipped).toBe(1);
    expect(planned.content?.tabs.map((t) => t.tabId)).toEqual(['lg2']);
    expect(planned.content?.group).toEqual({
      groupId: 'lg',
      title: 'Live group',
      color: 'red',
      collapsed: true,
    });
  });

  it('a group left with no tabs adds nothing', () => {
    const allThere = snapshotWindow(
      [
        liveTab('a', 'https://u1.test/', { chromeGroupId: 'g' }),
        liveTab('b', 'https://u4.test/', { chromeGroupId: 'g' }),
      ],
      [{ groupId: 'g', title: 'G', color: 'blue' }]
    );
    expect(
      tabsToCopy(
        allThere,
        { kind: 'group', windowId: 'live-w', groupId: 'g' },
        inS2()
      )
    ).toEqual({ content: null, skipped: 2 });
  });

  it('a window keeps its place, state, active tab and splits, minus the tabs already there', () => {
    const planned = windowToCopy(live(), inS2());
    expect(planned.skipped).toBe(2);
    const w = planned.content;
    expect(w?.tabs.map((t) => t.tabId)).toEqual(['lp', 'l1', 'l1b', 'lg2']);
    expect(w?.tabCount).toBe(4);
    expect(w?.activeTabId).toBe('l1');
    expect(w?.state).toBe('maximized');
    expect(w?.tabs[1].splitId).toBe('sp');
    expect(w?.chromeTabGroups?.map((g) => g.groupId)).toEqual(['lg']);
  });

  it('a window whose active tab was already there forgets it, and drops an emptied group', () => {
    const snapshot = snapshotWindow(
      [
        liveTab('a', 'https://u1.test/', { chromeGroupId: 'g' }),
        liveTab('b', 'https://b.test/'),
      ],
      [{ groupId: 'g', title: 'G', color: 'blue' }],
      { activeTabId: 'a' }
    );
    const w = windowToCopy(snapshot, inS2()).content;
    expect(w?.activeTabId).toBeUndefined();
    expect(w?.chromeTabGroups).toBeUndefined();
    expect(w?.tabs.map((t) => t.tabId)).toEqual(['b']);
  });

  it('a window left with no tabs adds nothing', () => {
    expect(
      windowToCopy(snapshotWindow([liveTab('a', 'https://u4.test/')]), inS2())
    ).toEqual({ content: null, skipped: 1 });
  });

  it('duplicates inside the carried item are kept', () => {
    const twice = snapshotWindow([
      liveTab('a', 'https://x.test/'),
      liveTab('b', 'https://x.test/'),
    ]);
    expect(
      windowToCopy(twice, inS2()).content?.tabs.map((t) => t.tabId)
    ).toEqual(['a', 'b']);
  });

  // Review Focus 5 (P7).
  it('an empty address is never already there', () => {
    const blank = session('S9', 'Blank', T0, [
      win('b1', [{ ...tab('e1'), url: '' }]),
    ]);
    expect(addressesIn(blank).size).toBe(0);
    expect(
      tabsToCopy(
        snapshotWindow([liveTab('e', '')]),
        { kind: 'tab', windowId: 'live-w', tabId: 'e' },
        addressesIn(blank)
      ).skipped
    ).toBe(0);
  });

  it('says how many it skips and whether anything is left, for every kind', () => {
    const taken = inS2();
    expect(
      copyOutcome(
        live(),
        { kind: 'tab', windowId: 'live-w', tabId: 'ldup' },
        taken
      )
    ).toEqual({ skipped: 1, copiesAny: false });
    expect(
      copyOutcome(
        live(),
        { kind: 'group', windowId: 'live-w', groupId: 'lg' },
        taken
      )
    ).toEqual({ skipped: 1, copiesAny: true });
    expect(
      copyOutcome(live(), { kind: 'window', windowId: 'live-w' }, taken)
    ).toEqual({ skipped: 2, copiesAny: true });
  });
});
