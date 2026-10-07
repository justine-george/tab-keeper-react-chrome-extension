import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { rootReducer } from '../../redux/storeConfig';
import {
  beginSetup,
  finishSetup,
  recordFirstRun,
  setFirstRunSession,
  setFirstRunStep,
} from '../../redux/slices/settingsDataStateSlice';

import { makeTestStore } from '../setup/makeStore';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { setupChromeFake } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  advanceRun,
  beginSaveStep,
  endRun,
  endRunAtFullViewButton,
  finishRunHere,
  goToRunStep,
  leaveRunHere,
  pinThisTab,
  reconcileRunHere,
  resumeRunHere,
  selectIsRunCardShown,
  selectRunHere,
  selectRunSession,
  startRun,
  stepRunBack,
  takeExampleForRun,
  takeRunSave,
} from '../../redux/firstRun';
import {
  deleteTabContainerInternal,
  moveToSessionInternal,
  replaceState,
  saveToTabContainerInternal,
  selectTabContainer,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  openFullViewCallout,
  openSetup,
  openSettingsPage,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { leaveSetup } from '../../redux/firstOpenFollowUps';
import { showInFullView } from '../../redux/fullViewShow';
import { undo } from '../../redux/slices/undoRedoSlice';
import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';
import { newRun } from '../../utils/functions/firstRun';
import { RUN_LOCK } from '../../utils/functions/tourLock';
import * as capture from '../../utils/functions/capture';
import {
  buildSampleSession,
  isSampleSession,
} from '../../utils/functions/sampleSession';
import { DELETE_TAB_CONTAINER_ACTION } from '../../utils/constants/actionTypes';

// Two stores sharing localStorage and one fake lock manager stand for two open pages.

type Store = ReturnType<typeof makeTestStore>['store'];

const NAMES = {
  title: 'Sample: Weekend trip',
  gettingThere: 'Getting there',
  thingsToDo: 'Things to do',
};
const OWN = buildSession({ tabGroupId: 'own', title: 'Own', createdAt: 2000 });
const OLDER = buildSession({
  tabGroupId: 'older',
  title: 'Older',
  createdAt: 1000,
});
const OPEN_PAGE = {
  id: 1,
  type: 'normal' as const,
  tabs: [{ id: 11, url: 'https://example.com/', title: 'Example' }],
};
const TK_ONLY = {
  id: 1,
  type: 'normal' as const,
  tabs: [
    {
      id: 12,
      url: 'chrome-extension://faketestid/index.html?view=tab',
      title: 'Tab Keeper',
    },
  ],
};

let locks: FakeLocks;
beforeEach(() => {
  localStorage.clear();
  locks = installFakeLocks();
  setupChromeFake({ windows: [OPEN_PAGE] });
});
afterEach(() => {
  locks.uninstall();
  localStorage.clear();
  history.replaceState(null, '', '?');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const runOf = (store: Store) => store.getState().settingsDataState.firstRun;
const ids = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);

function withSessions(...sessions: ReturnType<typeof buildSession>[]): Store {
  const { store } = makeTestStore();
  store.dispatch(replaceState(buildContainer(sessions)));
  return store;
}

describe('startRun', () => {
  test('the lock is held before the record is written', async () => {
    const { store } = makeTestStore();
    let heldAtRecord: boolean | null = null;
    store.subscribe(() => {
      if (heldAtRecord === null && runOf(store) !== null) {
        heldAtRecord = locks.held.has(RUN_LOCK);
      }
    });
    await store.dispatch(startRun(newRun('popup', 1)));
    expect(heldAtRecord).toBe(true);
    expect(selectRunHere(store.getState())).toEqual(newRun('popup', 1));
    expect(store.getState().globalState.hasRunShownHere).toBe(true);
  });

  test('it returns home: Settings closed, the search cleared, the callout closed', async () => {
    const { store } = makeTestStore();
    await store.dispatch(openSettingsPage(SettingsCategory.DISPLAY));
    store.dispatch(setSearchInputText('lisbon'));
    store.dispatch(openFullViewCallout());
    await store.dispatch(startRun(newRun('popup', 1)));
    const g = store.getState().globalState;
    expect([
      g.isSettingsPage,
      g.searchInputText,
      g.isFullViewCalloutOpen,
    ]).toEqual([false, '', false]);
  });

  test('a start replaces a running record and deletes nothing, its sample included (A4)', async () => {
    const store = withSessions(OWN);
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(takeExampleForRun(NAMES));
    const sampleId = ids(store).find(isSampleSession);
    await store.dispatch(startRun(newRun('popup', 1)));
    expect(runOf(store)).toEqual(newRun('popup', 1));
    expect(ids(store)).toEqual([sampleId, 'own']);
  });

  test('a second page’s start takes the run: the first stops showing it, and nothing is deleted', async () => {
    const first = withSessions(OWN);
    await first.dispatch(startRun(newRun('popup', 1)));
    first.dispatch(takeExampleForRun(NAMES));
    const firstRecord = runOf(first);
    const second = withSessions(OWN);
    await second.dispatch(startRun(newRun('popup', 1)));
    await expect.poll(() => first.getState().globalState.isRunHere).toBe(false);
    expect(selectRunHere(second.getState())).not.toBeNull();
    expect(ids(first)).toHaveLength(2);
    expect(runOf(first)).toEqual(firstRecord);
  });
});

describe('a leave or end while a start waits for the lock', () => {
  test('a leave: nothing is recorded or shown, and no lock is held', async () => {
    const { store } = makeTestStore();
    const started = store.dispatch(startRun(newRun('popup', 1)));
    await Promise.all([started, store.dispatch(leaveRunHere())]);
    expect(runOf(store)).toBeNull();
    expect(store.getState().globalState.isRunHere).toBe(false);
    expect(locks.held.has(RUN_LOCK)).toBe(false);
  });

  test('an end: nothing is recorded or shown, and no lock is held', async () => {
    const { store } = makeTestStore();
    const started = store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(endRun('skipped'));
    await started;
    expect(runOf(store)).toBeNull();
    expect(store.getState().globalState.isRunHere).toBe(false);
    // An end lets the lock go a few microtasks later.
    await expect.poll(() => locks.held.has(RUN_LOCK)).toBe(false);
  });

  test('a resume: the record stays as it was, not shown here, and no lock is held', async () => {
    const { store } = makeTestStore();
    store.dispatch(recordFirstRun(newRun('popup', 3)));
    const resumed = store.dispatch(resumeRunHere());
    await Promise.all([resumed, store.dispatch(leaveRunHere())]);
    expect(runOf(store)).toEqual(newRun('popup', 3));
    expect(store.getState().globalState.isRunHere).toBe(false);
    expect(locks.held.has(RUN_LOCK)).toBe(false);
  });

  test('CONTROL: a leave after the start settles stops it the same way', async () => {
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('popup', 1)));
    expect(store.getState().globalState.isRunHere).toBe(true);
    await store.dispatch(leaveRunHere());
    expect(store.getState().globalState.isRunHere).toBe(false);
    expect(locks.held.has(RUN_LOCK)).toBe(false);
  });
});

describe('leaving and resuming', () => {
  test('leaveRunHere lets the lock go and stops showing the run, leaving the record exactly as it was', async () => {
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('popup', 3)));
    const record = runOf(store);
    await store.dispatch(leaveRunHere());
    expect(runOf(store)).toEqual(record);
    expect(store.getState().globalState.isRunHere).toBe(false);
    expect(locks.held.has(RUN_LOCK)).toBe(false);
  });

  test('resumeRunHere shows a stored running record here, writing nothing', async () => {
    const { store } = makeTestStore();
    store.dispatch(recordFirstRun(newRun('popup', 3)));
    expect(selectRunHere(store.getState())).toBeNull();
    await store.dispatch(resumeRunHere());
    expect(selectRunHere(store.getState())).toEqual(newRun('popup', 3));
    expect(locks.held.has(RUN_LOCK)).toBe(true);
  });
});

describe('moving', () => {
  test('goToRunStep moves to a given step', async () => {
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(goToRunStep(5));
    expect(runOf(store)?.step).toBe(5);
    store.dispatch(goToRunStep(2));
    expect(runOf(store)?.step).toBe(2);
  });

  test('Next and Back move one step, Back not before step 2, Next not past the last', async () => {
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(stepRunBack());
    expect(runOf(store)?.step).toBe(1);
    for (let i = 0; i < 9; i += 1) store.dispatch(advanceRun());
    expect(runOf(store)?.step).toBe(7);
    store.dispatch(stepRunBack());
    expect(runOf(store)?.step).toBe(6);
  });

  test('a page that does not show the run moves nothing', () => {
    const { store } = makeTestStore();
    store.dispatch(advanceRun());
    expect(runOf(store)).toBeNull();
  });
});

describe('the save step’s card (R10, Q3)', () => {
  test('full view with saved sessions: your sessions, on the latest one', async () => {
    history.replaceState(null, '', '?view=tab');
    const store = withSessions(OLDER, OWN);
    await store.dispatch(startRun({ ...newRun('full', 3) }));
    await store.dispatch(beginSaveStep());
    expect(store.getState().globalState.runSaveCard).toBe('sessions');
    expect(runOf(store)?.sessionId).toBe('own');
  });

  test('the popup with saved sessions: the save card, no session picked', async () => {
    const store = withSessions(OWN);
    await store.dispatch(startRun(newRun('popup', 1)));
    await store.dispatch(beginSaveStep());
    expect(store.getState().globalState.runSaveCard).toBe('save');
    expect(runOf(store)?.sessionId).toBeNull();
  });

  test('only Tab Keeper open: nothing to save', async () => {
    setupChromeFake({ windows: [TK_ONLY] });
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('popup', 1)));
    await store.dispatch(beginSaveStep());
    expect(store.getState().globalState.runSaveCard).toBe('nothingToSave');
  });

  test('sessions on disk not loaded yet: no card is decided; after the load it is (CONTROL)', async () => {
    history.replaceState(null, '', '?view=tab');
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([OWN]))
    );
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('full', 3)));
    await store.dispatch(beginSaveStep());
    expect(store.getState().globalState.runSaveCard).toBeNull();
    expect(runOf(store)?.sessionId).toBeNull();
    store.dispatch(replaceState(buildContainer([OWN])));
    await store.dispatch(beginSaveStep());
    expect(store.getState().globalState.runSaveCard).toBe('sessions');
  });

  test('a card once decided stays for the page’s run (A5)', async () => {
    const store = withSessions(OWN);
    await store.dispatch(startRun(newRun('popup', 1)));
    await store.dispatch(beginSaveStep());
    store.dispatch(takeRunSave('own'));
    store.dispatch(stepRunBack());
    await store.dispatch(beginSaveStep());
    expect(store.getState().globalState.runSaveCard).toBe('save');
  });
});

describe('a resumed run at the save step with its session already taken', () => {
  const resumed = async (view: 'popup' | 'full') => {
    if (view === 'full') history.replaceState(null, '', '?view=tab');
    const store = withSessions(OWN, OLDER);
    const saveStep = view === 'full' ? 3 : 1;
    store.dispatch(
      recordFirstRun({ ...newRun(view, saveStep), sessionId: 'own' })
    );
    await store.dispatch(resumeRunHere());
    await store.dispatch(beginSaveStep());
    return store;
  };

  test('the popup gets the save card and the full view your sessions, with the session kept', async () => {
    const popup = await resumed('popup');
    expect(popup.getState().globalState.runSaveCard).toBe('save');
    expect(runOf(popup)?.sessionId).toBe('own');
    const full = await resumed('full');
    expect(full.getState().globalState.runSaveCard).toBe('sessions');
    expect(runOf(full)?.sessionId).toBe('own');
  });
});

describe('selectRunSession', () => {
  test('is the run’s own session, and nothing before the run has one', async () => {
    const store = withSessions(OWN, OLDER);
    await store.dispatch(startRun(newRun('popup', 1)));
    expect(selectRunSession(store.getState())).toBeUndefined();
    store.dispatch(takeRunSave('older'));
    expect(selectRunSession(store.getState())?.tabGroupId).toBe('older');
  });
});

describe('the run’s save and the example', () => {
  test('the first save becomes the run’s session, is selected, echoes, and moves on', async () => {
    const store = withSessions(OWN, OLDER);
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(selectTabContainer('older'));
    store.dispatch(takeRunSave('own'));
    expect(runOf(store)).toMatchObject({ step: 2, sessionId: 'own' });
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'own'
    );
    expect(store.getState().globalState.runSaveEcho).toBe('own');
  });

  test('a second save is ordinary: the run keeps its first session (R6)', async () => {
    const store = withSessions(OWN, OLDER);
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(takeRunSave('own'));
    await store.dispatch(stepRunBack());
    store.dispatch(takeRunSave('older'));
    expect(runOf(store)).toMatchObject({ step: 1, sessionId: 'own' });
  });

  test('Use an example adds the sample, makes it the run’s session, and moves on', async () => {
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(takeExampleForRun(NAMES));
    const [sampleId] = ids(store);
    expect(isSampleSession(sampleId)).toBe(true);
    expect(runOf(store)).toMatchObject({ step: 2, sessionId: sampleId });
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      sampleId
    );
  });

  test('with the run’s session set, Use an example adds nothing and moves on (R6)', async () => {
    const store = withSessions(OWN);
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(takeRunSave('own'));
    await store.dispatch(stepRunBack());
    store.dispatch(takeExampleForRun(NAMES));
    expect(ids(store)).toEqual(['own']);
    expect(runOf(store)?.step).toBe(2);
  });

  test('sessions still to load: no example is written over them', async () => {
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([OWN]))
    );
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(takeExampleForRun(NAMES));
    expect(
      JSON.parse(localStorage.getItem('tabContainerData') ?? '{}').tabGroups
    ).toHaveLength(1);
    expect(runOf(store)?.step).toBe(1);
  });
});

describe('endings', () => {
  test.each(['finished', 'skipped'] as const)(
    '%s on a sample: an ordinary undoable delete, the lock let go',
    async (ending) => {
      const { store, seen } = makeTestStore();
      await store.dispatch(startRun(newRun('popup', 1)));
      store.dispatch(takeExampleForRun(NAMES));
      store.dispatch(endRun(ending));
      expect(ids(store)).toEqual([]);
      expect(seen).toContain(DELETE_TAB_CONTAINER_ACTION);
      expect(runOf(store)?.ended).toBe(ending);
      await expect.poll(() => locks.held.has(RUN_LOCK)).toBe(false);
      store.dispatch(undo());
      expect(ids(store)).toHaveLength(1);
    }
  );

  // CONTROL: the test above, where the same endings remove an untouched sample.
  test.each(['finished', 'skipped'] as const)(
    '%s on a sample holding a tab moved in from the user’s session: it stays, with that tab',
    async (ending) => {
      const { store, seen } = makeTestStore();
      store.dispatch(replaceState(buildContainer([OWN])));
      await store.dispatch(startRun(newRun('popup', 1)));
      store.dispatch(takeExampleForRun(NAMES));
      const sampleId = runOf(store)?.sessionId ?? '';
      const sample = () =>
        store
          .getState()
          .tabContainerDataState.tabGroups.find(
            (g) => g.tabGroupId === sampleId
          );
      store.dispatch(
        moveToSessionInternal({
          carried: {
            kind: 'tab',
            tabGroupId: 'own',
            windowId: 'window-1',
            tabId: 'tab-1',
          },
          to: {
            tabGroupId: sampleId,
            windowId: sample()?.windows[0].windowId ?? '',
            toIndex: 0,
          },
        })
      );
      const urls = () =>
        sample()?.windows.flatMap((w) => w.tabs.map((t) => t.url)) ?? [];
      expect(isSampleSession(sampleId)).toBe(true);
      expect(urls()).toContain('https://example.com/');
      store.dispatch(endRun(ending));
      expect(ids(store)).toContain(sampleId);
      expect(urls()).toContain('https://example.com/');
      expect(seen).not.toContain(DELETE_TAB_CONTAINER_ACTION);
      expect(runOf(store)?.ended).toBe(ending);
    }
  );

  test.each(['finished', 'skipped', 'sessionGone'] as const)(
    '%s never deletes the user’s own session',
    async (ending) => {
      history.replaceState(null, '', '?view=tab');
      const store = withSessions(OWN, OLDER);
      await store.dispatch(startRun(newRun('full', 3)));
      await store.dispatch(beginSaveStep());
      store.dispatch(endRun(ending));
      expect(ids(store)).toEqual(['own', 'older']);
    }
  );

  test('a popup run’s end marks the callout seen; a full-view run’s does not (Q6)', async () => {
    const popup = makeTestStore().store;
    await popup.dispatch(startRun(newRun('popup', 1)));
    popup.dispatch(endRun('skipped'));
    expect(popup.getState().settingsDataState.isFullViewCalloutSeen).toBe(true);
    localStorage.clear();
    history.replaceState(null, '', '?view=tab');
    const full = makeTestStore().store;
    await full.dispatch(startRun(newRun('full', 0)));
    full.dispatch(endRun('skipped'));
    expect(full.getState().settingsDataState.isFullViewCalloutSeen).toBe(false);
  });
});

describe('reconcile (R2)', () => {
  test('the run’s session deleted elsewhere: ended quietly, not shown here', async () => {
    const store = withSessions(OWN);
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(takeRunSave('own'));
    store.dispatch(deleteTabContainerInternal('own'));
    store.dispatch(reconcileRunHere());
    expect(runOf(store)?.ended).toBe('sessionGone');
    expect(store.getState().globalState.isRunHere).toBe(false);
  });

  test('the run’s session renamed elsewhere: the run carries on', async () => {
    const store = withSessions(OWN);
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(takeRunSave('own'));
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'own', editableTitle: 'Renamed' })
    );
    store.dispatch(reconcileRunHere());
    expect(selectRunHere(store.getState())).toMatchObject({
      step: 2,
      sessionId: 'own',
    });
  });
});

describe('when the card shows (R3)', () => {
  test('the session steps need the run’s session on screen; the others only home', async () => {
    const store = withSessions(OWN, OLDER);
    await store.dispatch(startRun(newRun('popup', 1)));
    expect(selectIsRunCardShown(store.getState())).toBe(true);
    store.dispatch(takeRunSave('own'));
    expect(selectIsRunCardShown(store.getState())).toBe(true);
    store.dispatch(selectTabContainer('older'));
    expect(selectIsRunCardShown(store.getState())).toBe(false);
    store.dispatch(selectTabContainer('own'));
    store.dispatch(setSearchInputText('own'));
    expect(selectIsRunCardShown(store.getState())).toBe(false);
    store.dispatch(setSearchInputText(''));
    await store.dispatch(openSettingsPage(SettingsCategory.DISPLAY));
    expect(selectIsRunCardShown(store.getState())).toBe(false);
  });
});

describe('no ending deletes what the user made (safety)', () => {
  const popupRunOn = async (...sessions: ReturnType<typeof buildSession>[]) => {
    const harness = makeTestStore();
    harness.store.dispatch(replaceState(buildContainer(sessions)));
    await harness.store.dispatch(startRun(newRun('popup', 1)));
    harness.store.dispatch(takeRunSave('own'));
    return harness;
  };

  test.each(['finished', 'skipped', 'sessionGone', 'unanswered'] as const)(
    'a popup run on the user’s own save, ended %s keeps it',
    async (ending) => {
      const { store, seen } = await popupRunOn(OWN, OLDER);
      store.dispatch(endRun(ending));
      expect(ids(store)).toEqual(['own', 'older']);
      expect(seen).not.toContain(DELETE_TAB_CONTAINER_ACTION);
    }
  );

  test('⌘Z of the user’s own save: the run ends quietly and removes nothing itself', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(5_000_000);
    const { store, seen } = makeTestStore();
    store.dispatch(saveToTabContainerInternal(OLDER));
    await store.dispatch(startRun(newRun('popup', 1)));
    vi.setSystemTime(5_001_000);
    store.dispatch(saveToTabContainerInternal(OWN));
    store.dispatch(takeRunSave('own'));
    expect(ids(store)).toEqual(['own', 'older']);
    store.dispatch(undo());
    expect(ids(store)).toEqual(['older']);
    store.dispatch(reconcileRunHere());
    expect(runOf(store)?.ended).toBe('sessionGone');
    expect(ids(store)).toEqual(['older']);
    expect(seen).not.toContain(DELETE_TAB_CONTAINER_ACTION);
  });

  test('a replaced run: starting over leaves the user’s own session', async () => {
    const { store, seen } = await popupRunOn(OWN, OLDER);
    await store.dispatch(startRun(newRun('popup', 1)));
    expect(runOf(store)).toEqual(newRun('popup', 1));
    expect(ids(store)).toEqual(['own', 'older']);
    expect(seen).not.toContain(DELETE_TAB_CONTAINER_ACTION);
  });

  test('a sample still held among placeholder sessions is not deleted (R9 guard)', async () => {
    let n = 0;
    const sample = buildSampleSession(NAMES, new Date(3000), () => `x${n++}`);
    const base = combineReducers(rootReducer)(undefined, { type: '@@init' });
    const store = configureStore({
      reducer: combineReducers(rootReducer),
      middleware: (g) => g({ serializableCheck: false }),
      preloadedState: {
        ...base,
        tabContainerDataState: {
          ...base.tabContainerDataState,
          tabGroups: [sample],
        },
      },
    });
    expect(store.getState().globalState.holdsPlaceholderSessions).toBe(true);
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(setFirstRunSession(sample.tabGroupId));
    store.dispatch(endRun('skipped'));
    expect(ids(store)).toEqual([sample.tabGroupId]);
    expect(runOf(store)?.ended).toBe('skipped');
  });
});

describe('the last steps', () => {
  const TK_TAB = {
    id: 7,
    windowId: 1,
    url: 'chrome-extension://faketestid/index.html?view=tab',
  };

  test('Pin this tab pins this page’s own tab, then the run ends', async () => {
    history.replaceState(null, '', '?view=tab');
    setupChromeFake({ windows: [OPEN_PAGE], tabs: [TK_TAB], currentTabId: 7 });
    const update = vi.spyOn(chrome.tabs, 'update');
    const store = withSessions(OWN);
    await store.dispatch(startRun({ ...newRun('full', 8), sessionId: 'own' }));
    await store.dispatch(pinThisTab());
    expect(update).toHaveBeenCalledWith(7, { pinned: true });
    expect(runOf(store)?.ended).toBe('finished');
  });

  const pinSetting = (store: Store) =>
    store.getState().settingsDataState.pinTabKeeperInNewWindows;

  test('Pin this tab also turns on Pin Tab Keeper in new windows', async () => {
    history.replaceState(null, '', '?view=tab');
    setupChromeFake({ windows: [OPEN_PAGE], tabs: [TK_TAB], currentTabId: 7 });
    const store = withSessions(OWN);
    await store.dispatch(startRun({ ...newRun('full', 8), sessionId: 'own' }));
    expect(pinSetting(store)).toBe(false);
    await store.dispatch(pinThisTab());
    expect(pinSetting(store)).toBe(true);
  });

  test('a pin Chrome refuses still turns the setting on: the user asked for it', async () => {
    history.replaceState(null, '', '?view=tab');
    setupChromeFake({ windows: [OPEN_PAGE], tabs: [TK_TAB], currentTabId: 7 });
    vi.spyOn(chrome.tabs, 'update').mockRejectedValue(new Error('refused'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = withSessions(OWN);
    await store.dispatch(startRun({ ...newRun('full', 8), sessionId: 'own' }));
    await store.dispatch(pinThisTab());
    expect(pinSetting(store)).toBe(true);
    expect(runOf(store)?.ended).toBe('finished');
  });

  test('with no tab of its own (a popup), Pin this tab pins nothing and the run ends', async () => {
    history.replaceState(null, '', '?view=tab');
    const update = vi.spyOn(chrome.tabs, 'update');
    const store = withSessions(OWN);
    await store.dispatch(startRun({ ...newRun('full', 8), sessionId: 'own' }));
    await store.dispatch(pinThisTab());
    expect(update).not.toHaveBeenCalled();
    expect(runOf(store)?.ended).toBe('finished');
  });

  test('⤢ ends the popup run at its last step', async () => {
    const store = withSessions(OWN);
    await store.dispatch(startRun({ ...newRun('popup', 7), sessionId: 'own' }));
    store.dispatch(endRunAtFullViewButton());
    expect(runOf(store)?.ended).toBe('finished');
  });

  test('⤢ at any other step leaves the run alone', async () => {
    const store = withSessions(OWN);
    await store.dispatch(startRun({ ...newRun('popup', 6), sessionId: 'own' }));
    store.dispatch(endRunAtFullViewButton());
    expect(runOf(store)).toMatchObject({ step: 6, ended: null });
  });

  test.each([
    ['Pin this tab', () => pinThisTab()],
    ['Not now', () => finishRunHere()],
  ] as const)('%s never deletes the user’s own session', async (_, end) => {
    history.replaceState(null, '', '?view=tab');
    const { store, seen } = makeTestStore();
    store.dispatch(replaceState(buildContainer([OWN, OLDER])));
    await store.dispatch(startRun(newRun('full', 3)));
    await store.dispatch(beginSaveStep());
    await store.dispatch(goToRunStep(8));
    await store.dispatch(end());
    expect(runOf(store)?.ended).toBe('finished');
    expect(ids(store)).toEqual(['own', 'older']);
    expect(seen).not.toContain(DELETE_TAB_CONTAINER_ACTION);
  });

  test('⤢ never deletes the user’s own session', async () => {
    const { store, seen } = makeTestStore();
    store.dispatch(replaceState(buildContainer([OWN, OLDER])));
    await store.dispatch(startRun(newRun('popup', 1)));
    store.dispatch(takeRunSave('own'));
    store.dispatch(goToRunStep(7));
    store.dispatch(endRunAtFullViewButton());
    expect(runOf(store)?.ended).toBe('finished');
    expect(ids(store)).toEqual(['own', 'older']);
    expect(seen).not.toContain(DELETE_TAB_CONTAINER_ACTION);
  });

  test('the sample is removed when Pin this tab ends the run (R9)', async () => {
    history.replaceState(null, '', '?view=tab');
    const store = withSessions();
    await store.dispatch(startRun(newRun('full', 3)));
    store.dispatch(takeExampleForRun(NAMES));
    store.dispatch(goToRunStep(8));
    await store.dispatch(pinThisTab());
    expect(ids(store)).toEqual([]);
  });
});

describe('moving onto the save step (KAN-436)', () => {
  const atStepTwo = async () => {
    history.replaceState(null, '', '?view=tab');
    const harness = makeTestStore();
    harness.store.dispatch(replaceState(buildContainer([])));
    await harness.store.dispatch(startRun(newRun('full', 2)));
    return harness;
  };
  const stepWrites = (seen: string[]) =>
    seen.filter((type) => type === setFirstRunStep.type).length;

  test('Next decides the save card before the step changes', async () => {
    const { store } = await atStepTwo();
    let cardAtStep: string | null | undefined;
    store.subscribe(() => {
      if (cardAtStep === undefined && runOf(store)?.step === 3) {
        cardAtStep = store.getState().globalState.runSaveCard;
      }
    });
    await store.dispatch(advanceRun());
    expect(runOf(store)?.step).toBe(3);
    expect(cardAtStep).toBe('save');
  });

  test('a double Next during the decision advances once', async () => {
    const { store, seen } = await atStepTwo();
    const before = stepWrites(seen);
    await Promise.all([
      store.dispatch(advanceRun()),
      store.dispatch(advanceRun()),
    ]);
    expect(runOf(store)?.step).toBe(3);
    expect(stepWrites(seen) - before).toBe(1);
  });

  test('a Back during the decision wins', async () => {
    const { store } = await atStepTwo();
    const next = store.dispatch(advanceRun());
    await store.dispatch(stepRunBack());
    await next;
    expect(runOf(store)?.step).toBe(1);
  });

  test('a lock lost during the decision writes no step', async () => {
    const { store } = await atStepTwo();
    const next = store.dispatch(advanceRun());
    await store.dispatch(leaveRunHere());
    await next;
    expect(runOf(store)?.step).toBe(2);
  });

  test('a rejected tab query lands Next on the nothing-to-save card (KAN-438)', async () => {
    const { store } = await atStepTwo();
    vi.spyOn(capture, 'hasTabsToSave').mockRejectedValue(
      new Error('no windows')
    );
    await store.dispatch(advanceRun());
    expect(runOf(store)?.step).toBe(3);
    expect(store.getState().globalState.runSaveCard).toBe('nothingToSave');
  });

  test('Back onto a save card already decided moves at once', async () => {
    const store = withSessions(OWN);
    await store.dispatch(startRun(newRun('popup', 1)));
    await store.dispatch(beginSaveStep());
    store.dispatch(takeRunSave('own'));
    void store.dispatch(stepRunBack());
    expect(runOf(store)?.step).toBe(1);
  });
});

describe('after the full-view run (§3)', () => {
  beforeEach(() => history.replaceState(null, '', '?view=tab'));
  afterEach(() => history.replaceState(null, '', '?'));

  const openedOf = (store: Store) => [
    store.getState().globalState.isSetupOpen,
    store.getState().globalState.isPinGuideOpen,
  ];

  test('a new install finishes: setup opens; the pin guide waits for setup to close', async () => {
    setupChromeFake({ windows: [OPEN_PAGE], action: { isOnToolbar: false } });
    const { store } = makeTestStore();
    store.dispatch(beginSetup());
    await store.dispatch(startRun({ ...newRun('full', 8), sessionId: null }));
    await store.dispatch(finishRunHere());
    expect(openedOf(store)).toEqual([true, false]);
    await store.dispatch(leaveSetup());
    expect(openedOf(store)).toEqual([false, true]);
  });

  test('an upgrader finishes: setup goes from none to pending and opens (delta 8)', async () => {
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('full', 8)));
    await store.dispatch(finishRunHere());
    expect(store.getState().settingsDataState.setupState).toBe('pending');
    expect(store.getState().globalState.isSetupOpen).toBe(true);
  });

  test('setup done before, unpinned: the pin guide opens at once', async () => {
    setupChromeFake({ windows: [OPEN_PAGE], action: { isOnToolbar: false } });
    const { store } = makeTestStore();
    store.dispatch(finishSetup());
    await store.dispatch(startRun(newRun('full', 8)));
    await store.dispatch(finishRunHere());
    expect(openedOf(store)).toEqual([false, true]);
  });

  test('setup done before, pinned: nothing follows', async () => {
    setupChromeFake({ windows: [OPEN_PAGE], action: { isOnToolbar: true } });
    const { store } = makeTestStore();
    store.dispatch(finishSetup());
    await store.dispatch(startRun(newRun('full', 8)));
    await store.dispatch(finishRunHere());
    expect(openedOf(store)).toEqual([false, false]);
  });

  test('Skip tutorial opens nothing after it (R8)', async () => {
    const { store } = makeTestStore();
    store.dispatch(beginSetup());
    await store.dispatch(startRun(newRun('full', 3)));
    store.dispatch(endRun('skipped'));
    expect(openedOf(store)).toEqual([false, false]);
  });

  test('the popup run opens neither (§4)', async () => {
    history.replaceState(null, '', '?');
    const { store } = makeTestStore();
    store.dispatch(beginSetup());
    await store.dispatch(startRun(newRun('popup', 7)));
    await store.dispatch(finishRunHere());
    expect(openedOf(store)).toEqual([false, false]);
    expect(store.getState().settingsDataState.setupState).toBe('pending');
  });

  test('setup opened by Help closes without the pin guide (§2)', async () => {
    setupChromeFake({ windows: [OPEN_PAGE], action: { isOnToolbar: false } });
    const { store } = makeTestStore();
    store.dispatch(finishSetup());
    store.dispatch(showInFullView('setup'));
    expect(store.getState().globalState.isSetupOpen).toBe(true);
    await store.dispatch(leaveSetup());
    expect(openedOf(store)).toEqual([false, false]);
    expect(store.getState().settingsDataState.setupState).toBe('done');
  });

  test('control: the same machine, setup opened by the queue, goes on to the pin guide', async () => {
    setupChromeFake({ windows: [OPEN_PAGE], action: { isOnToolbar: false } });
    const { store } = makeTestStore();
    store.dispatch(beginSetup());
    store.dispatch(openSetup());
    await store.dispatch(leaveSetup());
    expect(openedOf(store)).toEqual([false, true]);
  });
});
