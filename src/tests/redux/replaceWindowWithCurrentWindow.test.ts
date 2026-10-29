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
}));

import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake, type ChromeSeed } from '../setup/chrome.fake';
import {
  deleteTabContainerInternal,
  deleteWindowInternal,
  replaceState,
  replaceWindowWithCurrentWindow,
} from '../../redux/slices/tabContainerDataStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import {
  T0,
  W1_BOUNDS,
  container,
  s1,
  s2,
  s3,
  sessionIn,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-866. One saved window takes the current browser window's tabs and groups; the rest of the session stays.

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

const TK = 'chrome-extension://faketestid/index.html?view=tab';
// The current window (the fake's first) holds a loose tab and a grouped one; a second window must not be captured.
const LIVE: ChromeSeed = {
  grantedPermissions: ['tabGroups'],
  windows: [
    {
      id: 1,
      focused: true,
      left: 300,
      top: 40,
      width: 900,
      height: 600,
      tabs: [
        { id: 11, url: 'https://a.test/', title: 'A' },
        { id: 12, url: 'https://b.test/', title: 'B', groupId: 50 },
        { id: 13, url: TK, title: 'Tab Keeper', active: true },
      ],
    },
    { id: 2, tabs: [{ id: 21, url: 'https://other.test/', title: 'O' }] },
  ],
  tabGroups: [{ id: 50, windowId: 1, title: 'Live', color: 'red' }],
};

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
type Store = ReturnType<typeof ready>['store'];
const toasts = (s: Store) => s.getState().globalState.toasts.map((t) => t.text);
const replace = (s: Store, windowId = 'w1') =>
  s
    .dispatch(replaceWindowWithCurrentWindow({ tabGroupId: 'S1', windowId }))
    .unwrap();

describe('replaceWindowWithCurrentWindow', () => {
  test('replaces that window only, keeping its id, name and place', async () => {
    handle = setupChromeFake(LIVE);
    const { store } = ready();
    expect(await replace(store)).toBe(true);
    const s = sessionIn(store.getState().tabContainerDataState, 'S1');
    expect(s.windows.map((w) => w.windowId)).toEqual(['w1', 'w2']);
    const w1 = windowIn(store.getState().tabContainerDataState, 'S1', 'w1');
    expect(w1.title).toBe('Window w1');
    expect(w1.tabs.map((t) => t.url)).toEqual([
      'https://a.test/',
      'https://b.test/',
    ]);
    expect(w1.tabCount).toBe(2);
    expect(w1.chromeTabGroups?.map((g) => [g.title, g.color])).toEqual([
      ['Live', 'red'],
    ]);
    expect(w1.tabs[1].chromeGroupId).toBe(w1.chromeTabGroups?.[0].groupId);
    expect(
      windowIn(store.getState().tabContainerDataState, 'S1', 'w2')
    ).toEqual(s1().windows[1]);
    expect(s.tabCount).toBe(3);
    expect(s.windowCount).toBe(2);
    expect(toasts(store)).toEqual([TOAST_MESSAGES.WINDOW_REPLACED]);
    expect(store.getState().globalState.toasts[0].offersUndo).toBe(true);
  });

  test('bounds and active tab come from the capture; a stale active tab goes', async () => {
    handle = setupChromeFake(LIVE);
    const { store } = ready();
    // The old window names an active tab the capture will not hold.
    const seeded = container([s3(), s2(), s1()], 'S1');
    seeded.tabGroups[2].windows[0].activeTabId = 't2';
    store.dispatch(replaceState(seeded));
    await replace(store);
    const w1 = windowIn(store.getState().tabContainerDataState, 'S1', 'w1');
    expect([
      w1.windowOffsetLeft,
      w1.windowOffsetTop,
      w1.windowWidth,
      w1.windowHeight,
    ]).toEqual([300, 40, 900, 600]);
    expect(w1.activeTabId).not.toBe('t2');
    expect(w1.tabs.some((t) => t.tabId === w1.activeTabId)).toBe(
      w1.activeTabId !== undefined
    );
  });

  test('one undo puts the old window back', async () => {
    handle = setupChromeFake(LIVE);
    const { store } = ready();
    await replace(store);
    store.dispatch(undo());
    const w1 = windowIn(store.getState().tabContainerDataState, 'S1', 'w1');
    expect(w1).toEqual(s1().windows[0]);
    expect(w1.windowWidth).toBe(W1_BOUNDS.width);
  });

  test('only Tab Keeper in the current window: nothing changes, and it says so', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1, focused: true, tabs: [{ id: 11, url: TK }] }],
    });
    const { store } = ready();
    const before = store.getState().tabContainerDataState;
    expect(await replace(store)).toBe(false);
    expect(store.getState().tabContainerDataState).toBe(before);
    expect(toasts(store)).toEqual([TOAST_MESSAGES.NOTHING_TO_SAVE_IN_WINDOW]);
  });

  test('the window deleted while capturing: nothing replaced, nothing said', async () => {
    handle = setupChromeFake(LIVE);
    const { store } = ready();
    const pending = replace(store);
    store.dispatch(deleteWindowInternal({ tabGroupId: 'S1', windowId: 'w1' }));
    const before = store.getState().tabContainerDataState;
    expect(await pending).toBe(false);
    expect(store.getState().tabContainerDataState).toBe(before);
    expect(toasts(store)).toEqual([]);
  });

  test('the session deleted while capturing: nothing replaced, nothing said', async () => {
    handle = setupChromeFake(LIVE);
    const { store } = ready();
    const pending = replace(store);
    store.dispatch(deleteTabContainerInternal('S1'));
    expect(await pending).toBe(false);
    expect(toasts(store)).toEqual([]);
  });

  test('an unknown window: nothing captured, nothing said', async () => {
    handle = setupChromeFake(LIVE);
    const { store } = ready();
    const before = store.getState().tabContainerDataState;
    expect(await replace(store, 'nope')).toBe(false);
    expect(store.getState().tabContainerDataState).toBe(before);
    expect(toasts(store)).toEqual([]);
  });
});
