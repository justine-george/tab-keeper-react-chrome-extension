import { afterEach, describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import { toastTexts } from '../setup/toasts';
import { showToast } from '../../redux/slices/globalStateSlice';
import {
  deleteTab,
  deleteTabContainer,
  replaceState,
} from '../../redux/slices/tabContainerDataStateSlice';
import { NEEDS_YOU_TOAST_MS, TOAST_MS } from '../../redux/toastDuration';
import {
  IMPORT_ERROR_FRAME,
  TOAST_MESSAGES,
} from '../../utils/constants/common';
import { SYNC_SIZE_REFUSAL } from '../../utils/functions/local';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-508. A toast's time follows its kind: 8s when it needs the user (a button, or an error), else 5s.

afterEach(() => {
  vi.useRealTimers();
});

type Store = ReturnType<typeof makeTestStore>['store'];
// On screen for exactly `ms`: there one tick before, gone at it.
const expectLastsExactly = (store: Store, text: string, ms: number) => {
  vi.advanceTimersByTime(ms - 1);
  expect(toastTexts(store.getState())).toContain(text);
  vi.advanceTimersByTime(1);
  expect(toastTexts(store.getState())).not.toContain(text);
};

describe('toast time by kind (KAN-508)', () => {
  test('the two times: 5s plain, 8s when it needs you', () => {
    expect([TOAST_MS, NEEDS_YOU_TOAST_MS]).toEqual([5000, 8000]);
  });

  test('a plain toast lasts 5s', async () => {
    const { store } = makeTestStore();
    vi.useFakeTimers();

    await store.dispatch(showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED }));

    expectLastsExactly(store, TOAST_MESSAGES.SYNC_MERGED, TOAST_MS);
  });

  // Every message by kind: an error added or dropped from ERROR_TOASTS fails its own case.
  const ERRORS = [
    TOAST_MESSAGES.UNREADABLE_ACCOUNT_TOKEN,
    TOAST_MESSAGES.UNREADABLE_CLOUD_DOCUMENT,
    TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED,
    TOAST_MESSAGES.IMPORT_SYNC_FAILED,
    TOAST_MESSAGES.REOPEN_FAILED,
    IMPORT_ERROR_FRAME,
    SYNC_SIZE_REFUSAL,
  ];
  const PLAIN = Object.values(TOAST_MESSAGES).filter(
    (text) => !ERRORS.includes(text)
  );

  test.each(ERRORS)('the error %s lasts 8s', async (text) => {
    const { store } = makeTestStore();
    vi.useFakeTimers();

    await store.dispatch(showToast({ toastText: text }));

    expectLastsExactly(store, text, NEEDS_YOU_TOAST_MS);
  });

  test.each(PLAIN)('%s, with no button, lasts 5s', async (text) => {
    const { store } = makeTestStore();
    vi.useFakeTimers();

    await store.dispatch(showToast({ toastText: text }));

    expectLastsExactly(store, text, TOAST_MS);
  });

  test('a toast with a Show button lasts 8s', async () => {
    const { store } = makeTestStore();
    vi.useFakeTimers();

    await store.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.MOVED_TO_SESSION,
        show: { tabGroupId: 's1' },
      })
    );

    expectLastsExactly(
      store,
      TOAST_MESSAGES.MOVED_TO_SESSION,
      NEEDS_YOU_TOAST_MS
    );
  });

  test('deleting a session shows its Undo toast for 8s (KAN-583)', async () => {
    const { store } = makeTestStore();
    store.dispatch(replaceState(buildContainer([buildSession()])));
    vi.useFakeTimers();

    await store.dispatch(deleteTabContainer('session-1'));
    // PREMISE: it offers Undo.
    expect(store.getState().globalState.toasts[0]?.offersUndo).toBe(true);

    expectLastsExactly(
      store,
      TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS,
      NEEDS_YOU_TOAST_MS
    );
  });

  test('deleting a tab (3s before KAN-508) shows its toast for 5s', async () => {
    const { store } = makeTestStore();
    store.dispatch(replaceState(buildContainer([buildSession()])));
    vi.useFakeTimers();

    await store.dispatch(
      deleteTab({
        tabGroupId: 'session-1',
        windowId: 'window-1',
        tabId: 'tab-1',
      })
    );
    // PREMISE: the tab was deleted.
    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.flatMap((g) => g.windows)
        .flatMap((w) => w.tabs)
        .map((t) => t.tabId)
    ).not.toContain('tab-1');

    expectLastsExactly(store, TOAST_MESSAGES.DELETE_TAB_SUCCESS, TOAST_MS);
  });
});
