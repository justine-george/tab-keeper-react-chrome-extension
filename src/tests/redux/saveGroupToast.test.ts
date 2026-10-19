import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { toastTexts } from '../setup/toasts';
import { saveToTabContainer } from '../../redux/slices/tabContainerDataStateSlice';
import { showToast } from '../../redux/slices/globalStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { openGroupToSession } from '../../utils/functions/openWindowsToSession';
import type { OpenWindow } from '../../utils/functions/openNow';

// KAN-696. Saving one live group announces itself as a group, and as a saved change.

const open: OpenWindow = {
  id: 1,
  isThisWindow: false,
  bounds: null,
  state: 'normal',
  incognito: false,
  groups: [{ id: 5, title: 'Docs', color: 'blue', collapsed: false }],
  tabs: [
    {
      id: 11,
      windowId: 1,
      title: 'X1',
      url: 'https://x1.test/',
      favIconUrl: '',
      active: true,
      pinned: false,
      audible: false,
      muted: false,
      groupId: 5,
      index: 0,
    },
  ],
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("saveToTabContainer with scope 'one-group'", () => {
  it("toasts the group wording, takes the Reopen offer's undo key, and one undo removes the session", async () => {
    const { store } = makeTestStore();
    await store.dispatch(
      showToast({ toastText: TOAST_MESSAGES.TAB_CLOSED, reopenOfferId: 1 })
    );
    const container = openGroupToSession(open, 5, new Date(), () => [], 'F');
    expect(container).not.toBeNull();
    if (container === null) return;

    await store.dispatch(saveToTabContainer({ container, scope: 'one-group' }));

    expect(toastTexts(store.getState())).toContain('Group saved as a session.');
    const offer = store
      .getState()
      .globalState.toasts.find((t) => t.reopenOffer !== null);
    expect(offer?.reopenOffer?.keepsUndoKey).toBe(false);
    expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(1);

    store.dispatch(undo());
    expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(0);
  });
});
