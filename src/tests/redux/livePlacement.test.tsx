import { describe, expect, it } from 'vitest';

import { setupChromeFake } from '../setup/chrome.fake';
import type { LiveSnapshot } from '../../redux/carriedItem';
import { placedWindowOf, readLivePlacement } from '../../redux/livePlacement';
import { live } from '../fixtures/liveSnapshotFixture';
import { makeTestStore } from '../setup/makeStore';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { copyOnSessionRow } from '../../redux/copyToSession';
import { container, sessionIn } from '../fixtures/sessionMoveFixture';

// KAN-280 Part F (P6, KAN-476's rule). A live window's place and state are read from Chrome when its carry starts.
describe('livePlacement', () => {
  it("a read place and state replace the list's; a window Chrome no longer has keeps the list's", async () => {
    setupChromeFake({
      windows: [
        {
          id: 7,
          left: 1,
          top: 2,
          width: 3,
          height: 4,
          state: 'normal',
          tabs: [{ url: 'https://x.test/' }],
        },
      ],
    });
    const snap: LiveSnapshot = {
      pick: { kind: 'window', windowId: 'live-w' },
      window: live(),
      chromeWindowId: 7,
    };
    expect(placedWindowOf(snap)).toBe(snap.window);
    await readLivePlacement(snap);
    expect(placedWindowOf(snap)).toMatchObject({
      windowOffsetLeft: 1,
      windowOffsetTop: 2,
      windowWidth: 3,
      windowHeight: 4,
    });
    // 'normal' stores nothing (KAN-460 D2), so the list's 'maximized' goes.
    expect(placedWindowOf(snap).state).toBeUndefined();
    expect('state' in placedWindowOf(snap)).toBe(false);

    const gone: LiveSnapshot = { ...snap, chromeWindowId: 99 };
    await readLivePlacement(gone);
    expect(placedWindowOf(gone)).toBe(gone.window);
  });

  it('a maximized window read keeps its state', async () => {
    setupChromeFake({
      windows: [
        {
          id: 8,
          left: 0,
          top: 0,
          width: 10,
          height: 10,
          state: 'maximized',
          tabs: [{ url: 'https://y.test/' }],
        },
      ],
    });
    const snap: LiveSnapshot = {
      pick: { kind: 'window', windowId: 'live-w' },
      window: live({ state: undefined }),
      chromeWindowId: 8,
    };
    await readLivePlacement(snap);
    expect(placedWindowOf(snap).state).toBe('maximized');
  });

  it("a window copied after the read lands at the place read, not the list's", async () => {
    localStorage.clear();
    setupChromeFake({
      windows: [
        {
          id: 9,
          left: 11,
          top: 12,
          width: 13,
          height: 14,
          state: 'normal',
          tabs: [{ url: 'https://z.test/' }],
        },
      ],
    });
    const snap: LiveSnapshot = {
      pick: { kind: 'window', windowId: 'live-w' },
      window: live(),
      chromeWindowId: 9,
    };
    await readLivePlacement(snap);
    const { store } = makeTestStore();
    store.dispatch(replaceState(container(undefined, 'S1')));
    expect(store.dispatch(copyOnSessionRow(snap, 'S2'))).toBe(true);
    const landed = sessionIn(store.getState().tabContainerDataState, 'S2')
      .windows[0];
    expect(landed).toMatchObject({
      windowId: 'live-w',
      windowOffsetLeft: 11,
      windowOffsetTop: 12,
      windowWidth: 13,
      windowHeight: 14,
    });
    expect(landed.state).toBeUndefined();
  });
});
