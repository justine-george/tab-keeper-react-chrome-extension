import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  ensureCloudSessionReady: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  hydrateFromOtherPage,
  replaceState,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  hydrateSettingsFromOtherPage,
  setTheme,
  grantCloudConsent,
  Theme,
  initialState as settingsInitialState,
} from '../../redux/slices/settingsDataStateSlice';
import {
  setFirebaseAuthed,
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import {
  IS_DIRTY_ACTION,
  TAB_CONTAINER_HYDRATE_FROM_OTHER_PAGE_ACTION,
} from '../../utils/constants/actionTypes';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';

// Signed in and consented, so the "would this start a sync" question is live
// rather than moot -- readyForSync() with no consent could never distinguish
// "no sync because hydrate is exempt" from "no sync because nothing may sync".
const readyForSync = () => {
  const { store, seen } = makeTestStore();
  store.dispatch(setUserId('u1'));
  store.dispatch(setSignedIn());
  store.dispatch(setFirebaseAuthed());
  store.dispatch(grantCloudConsent());
  seen.length = 0;
  return { store, seen };
};

describe('the hydrate action types match their reducers (KAN-279 D9)', () => {
  it('TAB_CONTAINER_HYDRATE_FROM_OTHER_PAGE_ACTION equals hydrateFromOtherPage.type', () => {
    expect(TAB_CONTAINER_HYDRATE_FROM_OTHER_PAGE_ACTION).toBe(
      hydrateFromOtherPage.type
    );
  });
});

describe('hydrateFromOtherPage (KAN-279 D9)', () => {
  it('does not call localStorage.setItem', () => {
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    const { store } = makeTestStore();
    setItemSpy.mockClear();

    store.dispatch(
      hydrateFromOtherPage(buildContainer([buildSession({ tabGroupId: 'x' })]))
    );

    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('does not record an undo step', () => {
    const { store } = makeTestStore();
    store.dispatch(
      replaceState(buildContainer([buildSession({ tabGroupId: 'a' })]))
    );
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'a', editableTitle: 'Edited' })
    );
    const pastBefore = store.getState().undoRedo.past;

    store.dispatch(
      hydrateFromOtherPage(buildContainer([buildSession({ tabGroupId: 'b' })]))
    );

    // Same reference, not just equal content: the undo history slice was
    // never dispatched into at all.
    expect(store.getState().undoRedo.past).toBe(pastBefore);
  });

  // CONTROL: replaceState is the reducer hydrateFromOtherPage was modelled on
  // and DOES write, so the negative above is discriminating rather than
  // vacuous -- the mutation below (pointing this same assertion at
  // replaceState) makes it fail.
  it('CONTROL: replaceState of the same payload does call setItem', () => {
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    const { store } = makeTestStore();
    setItemSpy.mockClear();

    store.dispatch(
      replaceState(buildContainer([buildSession({ tabGroupId: 'x' })]))
    );

    expect(setItemSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  describe('signed in and consented', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      localStorage.clear();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not dispatch IS_DIRTY_ACTION or, after the debounce, start a sync', () => {
      const { store, seen } = readyForSync();

      store.dispatch(
        hydrateFromOtherPage(
          buildContainer([buildSession({ tabGroupId: 'y' })])
        )
      );

      expect(seen).not.toContain(IS_DIRTY_ACTION);

      vi.advanceTimersByTime(DEBOUNCE_TIME_WINDOW + 1);

      expect(seen).not.toContain(syncStateWithFirestore.pending.type);
    });

    // CONTROL: a real edit on the same signed-in, consented store DOES dirty
    // and, once the debounce elapses, DOES start a sync -- so the negative
    // above is a property of hydrateFromOtherPage, not of the store setup.
    it('CONTROL: a real edit does dispatch IS_DIRTY_ACTION and, after the debounce, a sync pending', () => {
      const { store, seen } = readyForSync();
      store.dispatch(
        replaceState(buildContainer([buildSession({ tabGroupId: 'y' })]))
      );
      seen.length = 0;

      store.dispatch(
        updateTabGroupTitle({ tabGroupId: 'y', editableTitle: 'Edited' })
      );

      expect(seen).toContain(IS_DIRTY_ACTION);

      vi.advanceTimersByTime(DEBOUNCE_TIME_WINDOW + 1);

      expect(seen).toContain(syncStateWithFirestore.pending.type);
    });
  });
});

describe('hydrateSettingsFromOtherPage (KAN-279 D9)', () => {
  it('does not call localStorage.setItem', () => {
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    const { store } = makeTestStore();
    setItemSpy.mockClear();

    store.dispatch(
      hydrateSettingsFromOtherPage({
        ...settingsInitialState,
        theme: Theme.DARKENHEIMER,
      })
    );

    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  // CONTROL: an ordinary settings write DOES call setItem, so the negative
  // above is discriminating.
  it('CONTROL: setTheme does call setItem', () => {
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    const { store } = makeTestStore();
    setItemSpy.mockClear();

    store.dispatch(setTheme(Theme.DARKENHEIMER));

    expect(setItemSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
});
