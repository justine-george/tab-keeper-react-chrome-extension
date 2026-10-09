import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import { buildChromeTab } from '../fixtures/chromeTab';
import {
  replaceSessionWithOpenWindows,
  replaceState,
  deleteTabContainerInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { resetHistory } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import {
  T0,
  container,
  s1,
  s2,
  s3,
  sessionIn,
} from '../fixtures/sessionMoveFixture';

// KAN-468. The menu's action: capture every open window, replace, announce.

let handle: ReturnType<typeof setupChromeFake> | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  localStorage.clear();
});

const ready = () => {
  const made = makeTestStore();
  made.store.dispatch(replaceState(container([s3(), s2(), s1()], 'S1')));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  return made;
};
const toasts = (s: ReturnType<typeof ready>['store']) =>
  s.getState().globalState.toasts.map((t) => t.text);

describe('replaceSessionWithOpenWindows', () => {
  test('replaces with every open window and announces it', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            buildChromeTab({
              id: 11,
              windowId: 1,
              url: 'https://a.test/',
              title: 'A',
            }),
          ],
        },
        {
          id: 2,
          tabs: [
            buildChromeTab({
              id: 21,
              windowId: 2,
              url: 'https://b.test/',
              title: 'B',
            }),
          ],
        },
      ],
    });
    const { store } = ready();
    const result = await store
      .dispatch(replaceSessionWithOpenWindows('S1'))
      .unwrap();
    const s = sessionIn(store.getState().tabContainerDataState, 'S1');
    expect(result).toBe(true);
    expect(s.windows.flatMap((w) => w.tabs.map((t) => t.url)).sort()).toEqual([
      'https://a.test/',
      'https://b.test/',
    ]);
    expect(s.title).toBe('Source');
    expect(toasts(store)).toEqual([TOAST_MESSAGES.SESSION_REPLACED]);
  });

  test('only Tab Keeper pages open: nothing changes and nothing is said', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            buildChromeTab({
              id: 11,
              windowId: 1,
              url: 'chrome-extension://faketestid/index.html?view=tab',
            }),
          ],
        },
      ],
    });
    const { store } = ready();
    const before = store.getState().tabContainerDataState;
    expect(
      await store.dispatch(replaceSessionWithOpenWindows('S1')).unwrap()
    ).toBe(false);
    expect(store.getState().tabContainerDataState).toBe(before);
    expect(toasts(store)).toEqual([]);
  });

  test('the session gone while capturing: nothing replaced, nothing said', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            buildChromeTab({ id: 11, windowId: 1, url: 'https://a.test/' }),
          ],
        },
      ],
    });
    const { store } = ready();
    const pending = store.dispatch(replaceSessionWithOpenWindows('S1'));
    store.dispatch(deleteTabContainerInternal('S1'));
    expect(await pending.unwrap()).toBe(false);
    expect(toasts(store)).toEqual([]);
  });
});
