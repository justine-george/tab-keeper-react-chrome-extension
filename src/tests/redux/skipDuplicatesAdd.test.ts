import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load.
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
import {
  addCurrTabToWindow,
  addCurrWindowToTabGroup,
  saveToTabContainerInternal,
  type tabData,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setSkipDuplicateTabs } from '../../redux/slices/settingsDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-906. Add current window / Add current tab leave out what the session already has when Skip duplicate tabs is on.

const A = 'https://a.test/';
const B = 'https://b.test/';
const C = 'https://c.test/';
const D = 'https://d.test/';

const tabOf = (url: string, i: number): tabData => ({
  tabId: `${url}-${i}`,
  favicon: '',
  title: `T${i}`,
  url,
});

const windowOf = (id: string, ...urls: string[]): windowGroupData => ({
  ...buildSession().windows[0],
  windowId: id,
  tabCount: urls.length,
  tabs: urls.map(tabOf),
});

const setup = (on: boolean, ...sessionUrls: string[]) => {
  const { store } = makeTestStore();
  store.dispatch(setSkipDuplicateTabs(on));
  store.dispatch(
    saveToTabContainerInternal(
      buildSession({
        tabGroupId: 'g',
        tabCount: sessionUrls.length,
        windows: [windowOf('w', ...sessionUrls)],
      })
    )
  );
  return store;
};

const session = (store: ReturnType<typeof setup>) =>
  store.getState().tabContainerDataState.tabGroups[0];
const urlsOf = (store: ReturnType<typeof setup>) =>
  session(store).windows.map((w) => w.tabs.map((t) => t.url));
const lastToast = (store: ReturnType<typeof setup>) =>
  store.getState().globalState.toasts[
    store.getState().globalState.toasts.length - 1
  ];

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('addCurrWindowToTabGroup (KAN-906)', () => {
  it('On: [a, c, c] into [a, b] adds a window [c] and says 2 were left out', async () => {
    const store = setup(true, A, B);
    await store.dispatch(
      addCurrWindowToTabGroup({
        tabGroupId: 'g',
        window: windowOf('n', A, C, C),
      })
    );
    expect(urlsOf(store)).toEqual([[C], [A, B]]);
    expect(session(store).tabCount).toBe(3);
    expect(session(store).windowCount).toBe(2);
    expect(lastToast(store)).toMatchObject({
      text: TOAST_MESSAGES.ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS,
      leftOut: 2,
    });
  });

  it('On: every tab already there changes nothing and says so', async () => {
    const store = setup(true, A, B);
    const before = session(store);
    const steps = store.getState().undoRedo.past.length;
    await store.dispatch(
      addCurrWindowToTabGroup({
        tabGroupId: 'g',
        window: windowOf('n', A, B),
      })
    );
    expect(session(store)).toEqual(before);
    expect(store.getState().undoRedo.past).toHaveLength(steps);
    expect(lastToast(store)).toMatchObject({
      text: TOAST_MESSAGES.ADD_WINDOW_ALL_ALREADY_THERE,
      leftOut: 0,
    });
  });

  it('On: a session already holding [a, a] keeps both, and only [d] arrives', async () => {
    const store = setup(true, A, A);
    await store.dispatch(
      addCurrWindowToTabGroup({
        tabGroupId: 'g',
        window: windowOf('n', A, D),
      })
    );
    expect(urlsOf(store)).toEqual([[D], [A, A]]);
    expect(lastToast(store)).toMatchObject({ leftOut: 1 });
  });

  it('On: nothing left out adds the window whole, with no count', async () => {
    const store = setup(true, A);
    await store.dispatch(
      addCurrWindowToTabGroup({ tabGroupId: 'g', window: windowOf('n', B, C) })
    );
    expect(urlsOf(store)).toEqual([[B, C], [A]]);
    expect(lastToast(store)).toMatchObject({ leftOut: 0 });
  });

  it('On: undo after the [c] add restores the session exactly', async () => {
    const store = setup(true, A, B);
    const before = session(store);
    await store.dispatch(
      addCurrWindowToTabGroup({
        tabGroupId: 'g',
        window: windowOf('n', A, C),
      })
    );
    expect(urlsOf(store)).toEqual([[C], [A, B]]);
    store.dispatch(undo());
    // lastModified is the clock's, stamped again by undo; everything else is as it was.
    expect({ ...session(store), lastModified: 0 }).toEqual({
      ...before,
      lastModified: 0,
    });
  });

  it('On: a session id that is not there adds nothing and does not throw', async () => {
    const store = setup(true, A);
    await store.dispatch(
      addCurrWindowToTabGroup({
        tabGroupId: 'missing',
        window: windowOf('n', B),
      })
    );
    expect(urlsOf(store)).toEqual([[A]]);
  });

  it('Off: the repeats come along, with the usual toast', async () => {
    const store = setup(false, A, B);
    await store.dispatch(
      addCurrWindowToTabGroup({
        tabGroupId: 'g',
        window: windowOf('n', A, C, C),
      })
    );
    expect(urlsOf(store)).toEqual([
      [A, C, C],
      [A, B],
    ]);
    expect(session(store).tabCount).toBe(5);
    expect(lastToast(store)).toMatchObject({
      text: TOAST_MESSAGES.ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS,
      leftOut: 0,
    });
  });

  it('Off: a window the session already has is added anyway', async () => {
    const store = setup(false, A, B);
    await store.dispatch(
      addCurrWindowToTabGroup({
        tabGroupId: 'g',
        window: windowOf('n', A, B),
      })
    );
    expect(urlsOf(store)).toEqual([
      [A, B],
      [A, B],
    ]);
  });
});

describe('addCurrTabToWindow (KAN-906)', () => {
  const add = (store: ReturnType<typeof setup>, url: string) =>
    store.dispatch(
      addCurrTabToWindow({
        tabGroupId: 'g',
        windowId: 'w',
        tabData: tabOf(url, 9),
      })
    );

  it('On: a tab the session has changes nothing and says so', async () => {
    const store = setup(true, A, B);
    const before = session(store);
    await add(store, A);
    expect(session(store)).toEqual(before);
    expect(lastToast(store)).toMatchObject({
      text: TOAST_MESSAGES.THIS_SESSION_ALREADY_HAS_THIS_TAB,
    });
  });

  it('On: a tab the session lacks is added', async () => {
    const store = setup(true, A, B);
    await add(store, C);
    expect(urlsOf(store)).toEqual([[C, A, B]]);
    expect(lastToast(store)).toMatchObject({
      text: TOAST_MESSAGES.ADD_CURR_TAB_TO_WINDOW_SUCCESS,
    });
  });

  it('On: a tab with no address is added, never an address to compare', async () => {
    const store = setup(true, '');
    await add(store, '');
    expect(urlsOf(store)).toEqual([['', '']]);
  });

  it('Off: a tab the session has is added anyway', async () => {
    const store = setup(false, A, B);
    await add(store, A);
    expect(urlsOf(store)).toEqual([[A, A, B]]);
    expect(lastToast(store)).toMatchObject({
      text: TOAST_MESSAGES.ADD_CURR_TAB_TO_WINDOW_SUCCESS,
    });
  });
});
