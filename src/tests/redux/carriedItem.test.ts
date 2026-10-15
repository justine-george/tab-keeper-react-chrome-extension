import { describe, expect, it } from 'vitest';

import {
  isCarriedTabPinned,
  isItemStillThere,
  pickOf,
  savedItem,
  sourceSessionIdOf,
  sourceWindowOf,
} from '../../redux/carriedItem';
import {
  container,
  session,
  tab,
  T0,
  win,
} from '../fixtures/sessionMoveFixture';

// KAN-280 Part F (spec O12c): one reader for what a carry carries and where it came from.

const groups = () => container().tabGroups;

describe('carriedItem: a saved item', () => {
  it('names its kind and ids inside its source window, without the session', () => {
    expect(
      pickOf(
        savedItem({
          kind: 'tab',
          tabGroupId: 'S1',
          windowId: 'w1',
          tabId: 't1',
        })
      )
    ).toEqual({ kind: 'tab', windowId: 'w1', tabId: 't1' });
    expect(
      pickOf(
        savedItem({
          kind: 'group',
          tabGroupId: 'S1',
          windowId: 'w1',
          groupId: 'g1',
        })
      )
    ).toEqual({ kind: 'group', windowId: 'w1', groupId: 'g1' });
    expect(
      pickOf(savedItem({ kind: 'window', tabGroupId: 'S1', windowId: 'w2' }))
    ).toEqual({ kind: 'window', windowId: 'w2' });
  });

  it('comes from its own session', () => {
    expect(
      sourceSessionIdOf(
        savedItem({ kind: 'window', tabGroupId: 'S2', windowId: 'd1' })
      )
    ).toBe('S2');
  });

  it('reads its source window from the store, and null once it is gone', () => {
    const item = savedItem({
      kind: 'window',
      tabGroupId: 'S1',
      windowId: 'w2',
    });
    expect(sourceWindowOf(groups(), item)?.tabs.map((t) => t.tabId)).toEqual([
      't3',
    ]);
    expect(
      sourceWindowOf(
        groups(),
        savedItem({ kind: 'window', tabGroupId: 'S1', windowId: 'gone' })
      )
    ).toBeNull();
    expect(
      sourceWindowOf(
        groups(),
        savedItem({ kind: 'window', tabGroupId: 'gone', windowId: 'w2' })
      )
    ).toBeNull();
  });

  it('is still there while the store holds it, and not once it is taken away', () => {
    const t1 = savedItem({
      kind: 'tab',
      tabGroupId: 'S1',
      windowId: 'w1',
      tabId: 't1',
    });
    expect(isItemStillThere(groups(), t1)).toBe(true);
    const without = groups().map((g) =>
      g.tabGroupId !== 'S1'
        ? g
        : {
            ...g,
            windows: g.windows.map((w) => ({
              ...w,
              tabs: w.tabs.filter((t) => t.tabId !== 't1'),
            })),
          }
    );
    expect(isItemStillThere(without, t1)).toBe(false);
  });

  it('says a carried tab is pinned only when its stored tab is', () => {
    const all = [
      session('S1', 'Source', T0, [
        win('w1', [{ ...tab('p1'), pinned: true }, tab('t1')]),
      ]),
    ];
    const tabIn = (tabId: string) =>
      savedItem({ kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId });
    expect(isCarriedTabPinned(all, tabIn('p1'))).toBe(true);
    expect(isCarriedTabPinned(all, tabIn('t1'))).toBe(false);
    expect(
      isCarriedTabPinned(
        all,
        savedItem({ kind: 'window', tabGroupId: 'S1', windowId: 'w1' })
      )
    ).toBe(false);
  });
});
