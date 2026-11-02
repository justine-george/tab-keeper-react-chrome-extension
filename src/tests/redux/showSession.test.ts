// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// KAN-889. Spied, and the update still runs, so the store change is real.
vi.mock('../../components/home/paneMotion', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../components/home/paneMotion')>();
  return {
    ...actual,
    runPaneMotion: vi.fn((update: () => void) => update()),
  };
});

import { runPaneMotion } from '../../components/home/paneMotion';
import { showSession } from '../../redux/showSession';
import { selectIsSavedSessionFolded } from '../../redux/savedSessionFold';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-889. Folded away in the tab view, putting a session on screen slides it
// in as Show the saved session does; side by side, or in the popup, it moves nothing.
function storeWith(folded: boolean) {
  const { store } = makeTestStore();
  store.dispatch(
    replaceState(
      buildContainer([
        buildSession({ tabGroupId: 'S1', title: 'One' }),
        buildSession({ tabGroupId: 'S2', title: 'Two' }),
      ])
    )
  );
  store.dispatch(selectTabContainer('S1'));
  store.dispatch(setFoldSavedSessionInTabView(folded));
  return store;
}

beforeEach(() => {
  history.replaceState(null, '', '?view=tab');
  vi.mocked(runPaneMotion).mockClear();
});
afterEach(() => {
  history.replaceState(null, '', '?');
});

describe('showSession (KAN-889)', () => {
  test('folded: the peek runs inside the saved pane unfold motion', () => {
    const store = storeWith(true);
    store.dispatch(showSession('S2'));
    expect(runPaneMotion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runPaneMotion).mock.calls[0].slice(1)).toEqual([
      'saved',
      'unfold',
    ]);
    expect(selectIsSavedSessionFolded(store.getState())).toBe(false);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S2'
    );
    // Still a peek: the stored fold is unchanged.
    expect(store.getState().settingsDataState.foldSavedSessionInTabView).toBe(
      true
    );
  });

  test('folded: the selected session slides in too', () => {
    const store = storeWith(true);
    store.dispatch(showSession('S1'));
    expect(runPaneMotion).toHaveBeenCalledTimes(1);
    expect(selectIsSavedSessionFolded(store.getState())).toBe(false);
  });

  test('side by side: no motion, the selection changes', () => {
    const store = storeWith(false);
    store.dispatch(showSession('S2'));
    expect(runPaneMotion).not.toHaveBeenCalled();
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S2'
    );
  });

  test('the popup (not the tab view): no motion', () => {
    history.replaceState(null, '', '?');
    const store = storeWith(true);
    store.dispatch(showSession('S2'));
    expect(runPaneMotion).not.toHaveBeenCalled();
  });

  test('an id no longer in the list: nothing at all, motion included', () => {
    const store = storeWith(true);
    store.dispatch(showSession('gone'));
    expect(runPaneMotion).not.toHaveBeenCalled();
    expect(selectIsSavedSessionFolded(store.getState())).toBe(true);
  });

  test('folded: the selection happens at once; only the peek waits for the slide', () => {
    const store = storeWith(true);
    // A motion that has not run its update yet (a view transition runs it a frame later).
    vi.mocked(runPaneMotion).mockImplementationOnce(() => {});
    store.dispatch(showSession('S2'));
    // A caller's next dispatch (a rename, the tour's next step) sees the session selected.
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S2'
    );
    expect(selectIsSavedSessionFolded(store.getState())).toBe(true);
  });
});
