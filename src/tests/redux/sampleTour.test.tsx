import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { makeTestStore } from '../setup/makeStore';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  advanceSampleTour,
  deleteSessionFromMenu,
  endSampleTour,
  endTourIfInterrupted,
  reconcileTourHere,
  selectIsTourSampleShown,
  selectTourHere,
  startSampleTour,
  unfoldStepFourWindow,
} from '../../redux/sampleTour';
import {
  deleteTabContainerInternal,
  hydrateFromOtherPage,
  moveToSessionInternal,
  replaceState,
  saveToTabContainerInternal,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  recordSampleTour,
  recordValueMoment,
} from '../../redux/slices/settingsDataStateSlice';
import {
  collapsedWindowIdsOf,
  endSavedSessionPeek,
  openFullViewCallout,
  openSettingsPage,
  setSearchInputText,
  toggleWindowCollapse,
  tourStartedHere,
} from '../../redux/slices/globalStateSlice';
import { applyOtherPageSettings } from '../../redux/otherPageChanges';
import { setPresentStartup, undo } from '../../redux/slices/undoRedoSlice';
import { tourLockName } from '../../utils/functions/tourLock';
import { isValidTabMasterContainer } from '../../utils/functions/local';
import { isSampleSession } from '../../utils/functions/sampleSession';
import {
  DELETE_TAB_CONTAINER_ACTION,
  IS_DIRTY_ACTION,
} from '../../utils/constants/actionTypes';

// Two stores sharing localStorage and one fake lock manager stand for two open pages.

type Store = ReturnType<typeof makeTestStore>['store'];

const NAMES = {
  title: 'Sample: Weekend trip',
  gettingThere: 'Getting there',
  thingsToDo: 'Things to do',
};

let locks: FakeLocks;
beforeEach(() => {
  localStorage.clear();
  locks = installFakeLocks();
});
afterEach(() => {
  locks.uninstall();
  localStorage.clear();
  history.replaceState(null, '', '?');
});

const sampleIds = (store: Store) =>
  store
    .getState()
    .tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    .filter(isSampleSession);
const tourOf = (store: Store) => store.getState().settingsDataState.sampleTour;

async function started(): Promise<Store> {
  const { store } = makeTestStore();
  await store.dispatch(startSampleTour(NAMES));
  return store;
}

function diskSessions(): TabMasterContainer {
  const parsed: unknown = JSON.parse(
    localStorage.getItem('tabContainerData') ?? 'null'
  );
  if (!isValidTabMasterContainer(parsed)) throw new Error('nothing on disk');
  return parsed;
}
const storedTitles = () => diskSessions().tabGroups.map((g) => g.title);

// Another page's open: its first load and its settings, off the shared disk.
function openAnotherPage(): Store {
  const { store } = makeTestStore();
  store.dispatch(replaceState(diskSessions()));
  store.dispatch(applyOtherPageSettings());
  return store;
}

describe('starting', () => {
  test('adds the sample, selects it, records step 1 for this view and holds its lock', async () => {
    const { store, seen } = makeTestStore();
    await store.dispatch(startSampleTour(NAMES));

    const { tabGroups, selectedTabGroupId } =
      store.getState().tabContainerDataState;
    expect(tabGroups.map((g) => g.title)).toEqual(['Sample: Weekend trip']);
    const id = tabGroups[0].tabGroupId;
    expect(id.startsWith('sample:')).toBe(true);
    expect(selectedTabGroupId).toBe(id);
    expect(tourOf(store)).toEqual({ sampleId: id, step: 1, view: 'popup' });
    expect(selectTourHere(store.getState())?.sampleId).toBe(id);
    expect(store.getState().globalState.hasTourRunHere).toBe(true);
    expect(locks.held).toEqual(new Set([tourLockName(id)]));
    expect(seen).toContain(IS_DIRTY_ACTION);
    expect(seen).not.toContain(recordValueMoment.type);
  });

  test('the record is written only once its lock is held', async () => {
    const { store } = makeTestStore();
    const unheld: string[] = [];
    store.subscribe(() => {
      const tour = tourOf(store);
      if (tour !== null && !locks.held.has(tourLockName(tour.sampleId))) {
        unheld.push(tour.sampleId);
      }
    });
    await store.dispatch(startSampleTour(NAMES));
    expect(tourOf(store)).not.toBeNull();
    expect(unheld).toEqual([]);
  });

  test('in the full view it records the full view and peeks the folded saved session', async () => {
    history.replaceState(null, '', '?view=tab');
    const store = await started();
    expect(tourOf(store)?.view).toBe('full');
    expect(store.getState().globalState.isPeekingSavedSession).toBe(true);
    expect(selectIsTourSampleShown(store.getState())).toBe(true);
  });

  test('goes in at the top of a list that already has sessions', async () => {
    const { store } = makeTestStore();
    store.dispatch(
      replaceState(buildContainer([buildSession({ title: 'Mine' })]))
    );
    await store.dispatch(startSampleTour(NAMES));
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.title)
    ).toEqual(['Sample: Weekend trip', 'Mine']);
  });

  test('leaves Settings, clears a search, and closes the full-view callout', async () => {
    const { store } = makeTestStore();
    await store.dispatch(openSettingsPage(undefined));
    store.dispatch(setSearchInputText('trip'));
    store.dispatch(openFullViewCallout());
    await store.dispatch(startSampleTour(NAMES));
    const { globalState } = store.getState();
    expect(globalState.isSettingsPage).toBe(false);
    expect(globalState.searchInputText).toBe('');
    expect(globalState.isFullViewCalloutOpen).toBe(false);
  });

  test('a second press while the first waits adds one sample', async () => {
    const { store } = makeTestStore();
    await Promise.all([
      store.dispatch(startSampleTour(NAMES)),
      store.dispatch(startSampleTour(NAMES)),
    ]);
    expect(sampleIds(store)).toHaveLength(1);
    expect(locks.held.size).toBe(1);
  });

  test('starting over a recorded tour ends it first: one sample, one record, one lock', async () => {
    const store = await started();
    const [first] = sampleIds(store);
    await store.dispatch(startSampleTour(NAMES));
    const ids = sampleIds(store);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(first);
    expect(tourOf(store)?.sampleId).toBe(ids[0]);
    await vi.waitFor(() =>
      expect(locks.held).toEqual(new Set([tourLockName(ids[0])]))
    );
  });

  test('while sessions on disk are still to load, nothing is added and the disk is untouched', async () => {
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([buildSession({ title: 'Mine' })]))
    );
    const { store } = makeTestStore();
    await store.dispatch(startSampleTour(NAMES));
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
    expect(tourOf(store)).toBeNull();
    expect(storedTitles()).toEqual(['Mine']);

    // CONTROL: once the first load has happened, the same press starts it.
    store.dispatch(replaceState(diskSessions()));
    await store.dispatch(startSampleTour(NAMES));
    expect(sampleIds(store)).toHaveLength(1);
    expect(storedTitles()).toEqual(['Sample: Weekend trip', 'Mine']);
  });
});

describe('moving on', () => {
  test('Next moves one step at a time, and step 5 stays', async () => {
    const store = await started();
    for (const expected of [2, 3, 4, 5, 5]) {
      store.dispatch(advanceSampleTour());
      expect(tourOf(store)?.step).toBe(expected);
    }
  });

  test('a page that does not run the tour cannot move it', () => {
    const { store } = makeTestStore();
    store.dispatch(
      replaceState(buildContainer([buildSession({ tabGroupId: 'sample:x' })]))
    );
    store.dispatch(
      recordSampleTour({ sampleId: 'sample:x', step: 2, view: 'full' })
    );
    store.dispatch(advanceSampleTour());
    expect(tourOf(store)?.step).toBe(2);
  });

  // No snap-back: the user may have gone to another session.
  test('a step start never reselects the sample', async () => {
    const store = await started();
    store.dispatch(
      saveToTabContainerInternal(
        buildSession({ tabGroupId: 'mine', title: 'Mine' })
      )
    );
    expect(selectIsTourSampleShown(store.getState())).toBe(false);
    for (let i = 0; i < 3; i += 1) store.dispatch(advanceSampleTour());
    store.dispatch(unfoldStepFourWindow());
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'mine'
    );
    expect(selectIsTourSampleShown(store.getState())).toBe(false);
  });

  test('step 4 starts with the first window open, so its first tab is there to point at', async () => {
    const store = await started();
    const [id] = sampleIds(store);
    const first =
      store.getState().tabContainerDataState.tabGroups[0].windows[0].windowId;
    store.dispatch(toggleWindowCollapse({ tabGroupId: id, windowId: first }));
    store.dispatch(unfoldStepFourWindow());
    expect(
      collapsedWindowIdsOf(store.getState().globalState.collapsedWindows, id)
    ).toEqual([first]);
    for (let i = 0; i < 3; i += 1) store.dispatch(advanceSampleTour());
    store.dispatch(unfoldStepFourWindow());
    expect(
      collapsedWindowIdsOf(store.getState().globalState.collapsedWindows, id)
    ).toEqual([]);
  });
});

describe('ending', () => {
  test('removes the sample with no toast, clears the record, and lets go of the lock', async () => {
    const { store, seen } = makeTestStore();
    store.dispatch(
      replaceState(buildContainer([buildSession({ title: 'Mine' })]))
    );
    await store.dispatch(startSampleTour(NAMES));
    seen.length = 0;

    store.dispatch(endSampleTour());

    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.title)
    ).toEqual(['Mine']);
    expect(tourOf(store)).toBeNull();
    expect(selectTourHere(store.getState())).toBeNull();
    expect(store.getState().globalState.tourSampleIdHere).toBeNull();
    expect(store.getState().globalState.toasts).toEqual([]);
    // Synced like any delete.
    expect(seen).toContain(DELETE_TAB_CONTAINER_ACTION);
    expect(seen).toContain(IS_DIRTY_ACTION);
    await vi.waitFor(() => expect(locks.held.size).toBe(0));
  });

  test('at step 5, Delete session on the sample is the tour’s end, with no toast', async () => {
    const store = await started();
    const [id] = sampleIds(store);
    for (let i = 0; i < 4; i += 1) store.dispatch(advanceSampleTour());
    store.dispatch(deleteSessionFromMenu(id));
    expect(sampleIds(store)).toEqual([]);
    expect(tourOf(store)).toBeNull();
    expect(store.getState().globalState.toasts).toEqual([]);
  });

  test('before step 5 it is an ordinary delete with its toast, and the tour then ends quietly', async () => {
    const store = await started();
    const [id] = sampleIds(store);
    store.dispatch(deleteSessionFromMenu(id));
    await vi.waitFor(() =>
      expect(store.getState().globalState.toasts).toHaveLength(1)
    );
    expect(sampleIds(store)).toEqual([]);
    store.dispatch(reconcileTourHere());
    expect(tourOf(store)).toBeNull();
    expect(store.getState().globalState.tourSampleIdHere).toBeNull();
  });

  test('on another session it is an ordinary delete, and the tour goes on', async () => {
    const { store } = makeTestStore();
    store.dispatch(
      replaceState(
        buildContainer([buildSession({ tabGroupId: 'mine', title: 'Mine' })])
      )
    );
    await store.dispatch(startSampleTour(NAMES));
    for (let i = 0; i < 4; i += 1) store.dispatch(advanceSampleTour());
    store.dispatch(deleteSessionFromMenu('mine'));
    await vi.waitFor(() =>
      expect(store.getState().globalState.toasts).toHaveLength(1)
    );
    expect(tourOf(store)?.step).toBe(5);
  });

  test('Undo right after the tour’s end brings the sample back as an ordinary session', async () => {
    const store = await started();
    store.dispatch(endSampleTour());
    store.dispatch(undo());
    expect(sampleIds(store)).toHaveLength(1);
    store.dispatch(reconcileTourHere());
    expect(tourOf(store)).toBeNull();
    expect(selectTourHere(store.getState())).toBeNull();
    expect(sampleIds(store)).toHaveLength(1);
    expect(store.getState().settingsDataState.lastValueMomentTime).toBe('');
    expect(await store.dispatch(endTourIfInterrupted())).toBe('none');
    expect(sampleIds(store)).toHaveLength(1);
  });

  test('before this page has loaded its sessions it removes nothing and keeps the record', () => {
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(
        buildContainer([
          buildSession({
            tabGroupId: 'sample:x',
            title: 'Sample: Weekend trip',
          }),
          buildSession({ title: 'Mine' }),
        ])
      )
    );
    const { store } = makeTestStore();
    store.dispatch(
      recordSampleTour({ sampleId: 'sample:x', step: 2, view: 'popup' })
    );
    store.dispatch(endSampleTour());
    expect(tourOf(store)?.sampleId).toBe('sample:x');
    expect(storedTitles()).toEqual(['Sample: Weekend trip', 'Mine']);
  });

  test('a tab dragged from the sample into one of the user’s sessions stays there', async () => {
    const { store } = makeTestStore();
    store.dispatch(
      replaceState(
        buildContainer([buildSession({ tabGroupId: 'mine', title: 'Mine' })])
      )
    );
    await store.dispatch(startSampleTour(NAMES));
    const groups = () => store.getState().tabContainerDataState.tabGroups;
    const sample = groups().find((g) => isSampleSession(g.tabGroupId));
    const mine = groups().find((g) => g.tabGroupId === 'mine');
    if (sample === undefined || mine === undefined)
      throw new Error('no sessions');
    const [from] = sample.windows;
    const [tab] = from.tabs;
    store.dispatch(
      moveToSessionInternal({
        carried: {
          kind: 'tab',
          tabGroupId: sample.tabGroupId,
          windowId: from.windowId,
          tabId: tab.tabId,
        },
        to: {
          tabGroupId: 'mine',
          windowId: mine.windows[0].windowId,
          toIndex: 0,
        },
      })
    );
    store.dispatch(endSampleTour());
    expect(groups().map((g) => g.title)).toEqual(['Mine']);
    expect(groups()[0].windows[0].tabs[0].url).toBe(tab.url);
  });
});

describe('the tour this page runs, reconciled', () => {
  test('Undo of the start takes the sample away, and the tour ends quietly', async () => {
    const store = await started();
    store.dispatch(undo());
    expect(sampleIds(store)).toEqual([]);
    store.dispatch(reconcileTourHere());
    expect(tourOf(store)).toBeNull();
    expect(store.getState().globalState.tourSampleIdHere).toBeNull();
    await vi.waitFor(() => expect(locks.held.size).toBe(0));
  });

  test('a delete from the list ends it quietly', async () => {
    const store = await started();
    store.dispatch(deleteTabContainerInternal(sampleIds(store)[0]));
    store.dispatch(reconcileTourHere());
    expect(tourOf(store)).toBeNull();
  });

  test('another page started a new tour: this page stops, and leaves the sessions to that page', async () => {
    const store = await started();
    const [id] = sampleIds(store);
    store.dispatch(
      recordSampleTour({ sampleId: 'sample:other', step: 1, view: 'full' })
    );
    store.dispatch(reconcileTourHere());
    expect(selectTourHere(store.getState())).toBeNull();
    expect(store.getState().globalState.tourSampleIdHere).toBeNull();
    expect(tourOf(store)?.sampleId).toBe('sample:other');
    expect(sampleIds(store)).toEqual([id]);
    await vi.waitFor(() =>
      expect(locks.held.has(tourLockName(id))).toBe(false)
    );
  });

  test('another page’s write without the sample ends the tour quietly, with no toast', async () => {
    const store = await started();
    store.dispatch(
      hydrateFromOtherPage(
        buildContainer([buildSession({ tabGroupId: 'mine', title: 'Mine' })])
      )
    );
    store.dispatch(reconcileTourHere());
    expect(tourOf(store)).toBeNull();
    expect(store.getState().globalState.tourSampleIdHere).toBeNull();
    expect(store.getState().globalState.toasts).toEqual([]);
  });

  test('before this page has loaded its sessions, a tour run here is left as recorded', () => {
    const { store } = makeTestStore();
    store.dispatch(
      recordSampleTour({ sampleId: 'sample:x', step: 1, view: 'popup' })
    );
    store.dispatch(tourStartedHere('sample:x'));
    store.dispatch(reconcileTourHere());
    expect(tourOf(store)?.sampleId).toBe('sample:x');
    expect(store.getState().globalState.tourSampleIdHere).toBe('sample:x');
  });
});

describe('the next open, after an interruption', () => {
  test('a tour still running in another open page is left alone, sample and all', async () => {
    const running = await started();
    const [id] = sampleIds(running);
    const other = openAnotherPage();
    expect(await other.dispatch(endTourIfInterrupted())).toBe('elsewhere');
    expect(sampleIds(other)).toEqual([id]);
    expect(tourOf(other)?.sampleId).toBe(id);
    expect(storedTitles()).toEqual(['Sample: Weekend trip']);
    expect(selectTourHere(running.getState())?.sampleId).toBe(id);
  });

  test('CONTROL: once that page has gone, the next open ends it and removes the sample', async () => {
    await started();
    locks.dropAll();
    const other = openAnotherPage();
    expect(await other.dispatch(endTourIfInterrupted())).toBe('ended');
    expect(sampleIds(other)).toEqual([]);
    expect(tourOf(other)).toBeNull();
    expect(storedTitles()).toEqual([]);
  });

  // CONTROL: "Undo right after the tour’s end" above, where ⌘Z does bring it back.
  test('the cleanup syncs like any delete, and ⌘Z after it brings nothing back', async () => {
    await started();
    locks.dropAll();
    const { store: other, seen } = makeTestStore();
    other.dispatch(replaceState(diskSessions()));
    // As App's local-only startup does, so an undo step would restore the sample.
    other.dispatch(
      setPresentStartup({
        tabContainerDataState: other.getState().tabContainerDataState,
      })
    );
    other.dispatch(applyOtherPageSettings());
    seen.length = 0;
    expect(await other.dispatch(endTourIfInterrupted())).toBe('ended');
    expect(seen).toContain(IS_DIRTY_ACTION);
    expect(other.getState().undoRedo.past).toEqual([]);
    other.dispatch(undo());
    expect(sampleIds(other)).toEqual([]);
    expect(storedTitles()).toEqual([]);
  });

  test('a browser that cannot say which page runs it leaves the tour alone', async () => {
    const running = await started();
    const [id] = sampleIds(running);
    locks.uninstall();
    const other = openAnotherPage();
    expect(await other.dispatch(endTourIfInterrupted())).toBe('unknown');
    expect(sampleIds(other)).toEqual([id]);
  });

  test('the page running the tour never ends it as interrupted', async () => {
    const running = await started();
    locks.dropAll();
    expect(await running.dispatch(endTourIfInterrupted())).toBe('here');
    expect(sampleIds(running)).toHaveLength(1);
  });

  test('a record that changed while the browser was asked is left to its new owner', async () => {
    await started();
    locks.dropAll();
    const other = openAnotherPage();
    const asked = other.dispatch(endTourIfInterrupted());
    other.dispatch(
      recordSampleTour({ sampleId: 'sample:newer', step: 1, view: 'popup' })
    );
    expect(await asked).toBe('none');
    expect(tourOf(other)?.sampleId).toBe('sample:newer');
  });

  test('no record, nothing to do', async () => {
    const { store } = makeTestStore();
    expect(await store.dispatch(endTourIfInterrupted())).toBe('none');
  });

  // Never decided against the placeholder.
  test('before this page has loaded its sessions, nothing is decided', async () => {
    await started();
    locks.dropAll();
    const { store } = makeTestStore();
    store.dispatch(applyOtherPageSettings());
    expect(await store.dispatch(endTourIfInterrupted())).toBe('unloaded');
    expect(storedTitles()).toEqual(['Sample: Weekend trip']);
    expect(tourOf(store)).not.toBeNull();
  });
});

describe('selectIsTourSampleShown', () => {
  test('false under a search that hides it, and with another session selected', async () => {
    const store = await started();
    expect(selectIsTourSampleShown(store.getState())).toBe(true);
    store.dispatch(setSearchInputText('zzz'));
    expect(selectIsTourSampleShown(store.getState())).toBe(false);
    store.dispatch(setSearchInputText(''));
    store.dispatch(
      saveToTabContainerInternal(buildSession({ tabGroupId: 'mine' }))
    );
    expect(selectIsTourSampleShown(store.getState())).toBe(false);
  });

  // Open and ⋮ are hidden under any search, so the tour is too.
  test('false under a search the sample matches', async () => {
    const store = await started();
    store.dispatch(setSearchInputText('Weekend'));
    expect(selectIsTourSampleShown(store.getState())).toBe(false);
  });

  test('in the full view, false once the saved session is folded away again', async () => {
    history.replaceState(null, '', '?view=tab');
    const store = await started();
    store.dispatch(endSavedSessionPeek());
    expect(selectIsTourSampleShown(store.getState())).toBe(false);
  });
});
