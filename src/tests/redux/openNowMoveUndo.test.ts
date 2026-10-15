import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  noteTabKeeperAction,
  openNowDropHoldsUndoKey,
  storeOpenNowDrop,
  subscribeToOpenNowDrop,
  takeOpenNowDrop,
} from '../../redux/openNowMoveUndo';
import type { OpenNowDrop } from '../../utils/functions/openNowMoves';

// KAN-280 spec O11f, ledger R23: ⌘Z undoes the most recent Tab Keeper
// action, and a drop's undo lasts until the next one.

const drop = (tabId: number): OpenNowDrop => ({
  kind: 'tab',
  moved: [
    {
      tabId,
      before: { windowId: 1, index: 0, groupId: -1, group: null },
      after: { windowId: 1, index: 1, groupId: -1, group: null },
    },
  ],
});

afterEach(() => {
  // Module state outlives a test: a later action leaves nothing to take.
  noteTabKeeperAction();
});

describe("⌘Z's Open now drop", () => {
  test('the latest drop is taken, once', () => {
    const first = drop(1);
    storeOpenNowDrop(first);

    expect(takeOpenNowDrop()).toBe(first);
    expect(takeOpenNowDrop()).toBeNull();
  });

  test('nothing stored: nothing to take', () => {
    expect(takeOpenNowDrop()).toBeNull();
  });

  test('an action after the drop supersedes it', () => {
    storeOpenNowDrop(drop(1));
    noteTabKeeperAction();

    expect(takeOpenNowDrop()).toBeNull();
  });

  test('CONTROL: an action before the drop does not', () => {
    noteTabKeeperAction();
    const latest = drop(1);
    storeOpenNowDrop(latest);

    expect(takeOpenNowDrop()).toBe(latest);
  });

  test('a newer drop replaces the older one, which is gone for good', () => {
    const older = drop(1);
    const newer = drop(2);
    storeOpenNowDrop(older);
    storeOpenNowDrop(newer);

    expect(takeOpenNowDrop()).toBe(newer);
    expect(takeOpenNowDrop()).toBeNull();
  });
});

// KAN-590. The Toast hides its ⌘Z hint exactly while the key would take a drop.
describe('a drop holds the undo key', () => {
  test('nothing stored: it does not', () => {
    expect(openNowDropHoldsUndoKey()).toBe(false);
  });

  test('from its store until it is taken', () => {
    storeOpenNowDrop(drop(1));
    expect(openNowDropHoldsUndoKey()).toBe(true);

    takeOpenNowDrop();

    expect(openNowDropHoldsUndoKey()).toBe(false);
  });

  test('until an action after it', () => {
    storeOpenNowDrop(drop(1));

    noteTabKeeperAction();

    expect(openNowDropHoldsUndoKey()).toBe(false);
  });

  test('CONTROL: an action before it leaves the key with the drop', () => {
    noteTabKeeperAction();
    storeOpenNowDrop(drop(1));

    expect(openNowDropHoldsUndoKey()).toBe(true);
  });
});

describe('subscribeToOpenNowDrop', () => {
  test('a store, a take and an action each tell the listener', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToOpenNowDrop(listener);

    storeOpenNowDrop(drop(1));
    expect(listener).toHaveBeenCalledTimes(1);
    takeOpenNowDrop();
    expect(listener).toHaveBeenCalledTimes(2);
    noteTabKeeperAction();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
  });

  test('unsubscribed, it hears nothing', () => {
    const listener = vi.fn();
    subscribeToOpenNowDrop(listener)();

    storeOpenNowDrop(drop(1));

    expect(listener).not.toHaveBeenCalled();
  });
});
