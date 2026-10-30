import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { makeTestStore } from '../setup/makeStore';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { setupChromeFake } from '../setup/chrome.fake';
import { leaveSetup } from '../../redux/firstOpenFollowUps';
import { showInFullView } from '../../redux/fullViewShow';
import {
  finishRunHere,
  leaveReplayNote,
  skipRun,
  startRun,
} from '../../redux/firstRun';
import {
  closeEnding,
  requestEnding,
  showEnding,
} from '../../redux/onboardingEnding';
import { openSetup, setEndingCard } from '../../redux/slices/globalStateSlice';
import {
  beginSetup,
  markEndingSeen,
} from '../../redux/slices/settingsDataStateSlice';
import { newRun, type RunView } from '../../utils/functions/firstRun';

// KAN-879. The ending is asked for once per view: after setup in the full view,
// after a finished popup run's note in the popup; never after a Help replay.

type Store = ReturnType<typeof makeTestStore>['store'];

let locks: FakeLocks;
beforeEach(() => {
  localStorage.clear();
  locks = installFakeLocks();
  setupChromeFake({ action: { isOnToolbar: true } });
});
afterEach(() => {
  locks.uninstall();
  localStorage.clear();
  history.replaceState(null, '', '?');
  vi.restoreAllMocks();
});

const inView = (view: RunView) =>
  history.replaceState(null, '', view === 'full' ? '?view=tab' : '?');

const endingOf = (store: Store) => store.getState().globalState.endingCard;

const storedFlags = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

// A first-time setup, as the open queue or a finished run opens it.
const firstSetup = (store: Store) => {
  store.dispatch(beginSetup());
  store.dispatch(openSetup());
};

describe('the full view: after setup', () => {
  beforeEach(() => inView('full'));

  test('leaving a first-time setup, toolbar pinned, asks for the ending', async () => {
    const { store } = makeTestStore();
    firstSetup(store);
    expect(endingOf(store)).toBeNull();
    await store.dispatch(leaveSetup());
    expect(store.getState().globalState.isPinGuideOpen).toBe(false);
    expect(endingOf(store)).toBe('pending');
  });

  test('requests the ending only after the pin guide has decided', async () => {
    let answer: (settings: chrome.action.UserSettings) => void = () =>
      undefined;
    vi.spyOn(chrome.action, 'getUserSettings').mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const { store } = makeTestStore();
    firstSetup(store);
    const leaving = store.dispatch(leaveSetup());
    await Promise.resolve();
    expect(store.getState().globalState.isSetupOpen).toBe(false);
    expect(endingOf(store)).toBeNull();

    answer({ isOnToolbar: false });
    await leaving;
    expect(store.getState().globalState.isPinGuideOpen).toBe(true);
    expect(endingOf(store)).toBe('pending');
  });

  test('Help’s setup is a replay: leaving it asks for nothing', async () => {
    const { store } = makeTestStore();
    store.dispatch(beginSetup());
    store.dispatch(openSetup({ leadsToPinGuide: false, isReplay: true }));
    await store.dispatch(leaveSetup());
    expect(endingOf(store)).toBeNull();
  });

  test('Help → Run setup again opens a replay setup: leaving it asks for nothing', async () => {
    const { store } = makeTestStore();
    store.dispatch(showInFullView('setup'));
    expect(store.getState().globalState.isSetupOpen).toBe(true);
    expect(store.getState().globalState.isSetupReplay).toBe(true);
    await store.dispatch(leaveSetup());
    expect(endingOf(store)).toBeNull();
  });

  test('CONTROL: a setup opened with no marker is a first-time one', async () => {
    const { store } = makeTestStore();
    store.dispatch(openSetup({ leadsToPinGuide: false, isReplay: true }));
    store.dispatch(openSetup());
    expect(store.getState().globalState.isSetupReplay).toBe(false);
  });

  test('a finished run: the note, then setup, then the ending', async () => {
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('full', 8)));
    await store.dispatch(finishRunHere());
    await store.dispatch(leaveReplayNote());
    expect(store.getState().globalState.isSetupOpen).toBe(true);
    expect(store.getState().globalState.isSetupReplay).toBe(false);
    expect(endingOf(store)).toBeNull();
    await store.dispatch(leaveSetup());
    expect(endingOf(store)).toBe('pending');
  });

  test('a finished Help replay with setup pending: that setup is a replay too, and no ending', async () => {
    const { store } = makeTestStore();
    store.dispatch(beginSetup());
    await store.dispatch(startRun(newRun('full', 8, 'welcome', 'full', true)));
    await store.dispatch(finishRunHere());
    await store.dispatch(leaveReplayNote());
    expect(store.getState().globalState.isSetupOpen).toBe(true);
    expect(store.getState().globalState.isSetupReplay).toBe(true);
    await store.dispatch(leaveSetup());
    expect(endingOf(store)).toBeNull();
  });

  test('a skipped run ends at the note: setup waits for a later open', async () => {
    const { store } = makeTestStore();
    store.dispatch(beginSetup());
    await store.dispatch(startRun(newRun('full', 3)));
    store.dispatch(skipRun());
    await store.dispatch(leaveReplayNote());
    expect(store.getState().globalState.isSetupOpen).toBe(false);
    expect(endingOf(store)).toBeNull();
  });
});

describe('the popup: after a finished run’s note', () => {
  beforeEach(() => inView('popup'));

  test('Got it on a finished run’s note asks for the ending', async () => {
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('popup', 7)));
    await store.dispatch(finishRunHere());
    expect(store.getState().globalState.isReplayNoteOpen).toBe(true);
    expect(endingOf(store)).toBeNull();
    await store.dispatch(leaveReplayNote());
    expect(endingOf(store)).toBe('pending');
  });

  test('a skipped run gets the note and nothing after it', async () => {
    const { store } = makeTestStore();
    await store.dispatch(startRun(newRun('popup', 3)));
    store.dispatch(skipRun());
    await store.dispatch(leaveReplayNote());
    expect(endingOf(store)).toBeNull();
  });

  test('a finished Help replay gets the note and nothing after it', async () => {
    const { store } = makeTestStore();
    await store.dispatch(
      startRun(newRun('popup', 7, 'welcome', 'popup', true))
    );
    await store.dispatch(finishRunHere());
    await store.dispatch(leaveReplayNote());
    expect(endingOf(store)).toBeNull();
  });
});

describe('once per view', () => {
  test('requestEnding does nothing once this view’s flag is set', async () => {
    inView('full');
    const { store } = makeTestStore();
    store.dispatch(markEndingSeen('full'));
    firstSetup(store);
    await store.dispatch(leaveSetup());
    expect(endingOf(store)).toBeNull();
  });

  test('the popup’s flag does not hold back the full view', () => {
    inView('full');
    const { store } = makeTestStore();
    store.dispatch(markEndingSeen('popup'));
    store.dispatch(requestEnding());
    expect(endingOf(store)).toBe('pending');
  });

  test('the full view’s flag does not hold back the popup', () => {
    inView('popup');
    const { store } = makeTestStore();
    store.dispatch(markEndingSeen('full'));
    store.dispatch(requestEnding());
    expect(endingOf(store)).toBe('pending');
  });

  test('a card on screen is not asked for again', () => {
    inView('full');
    const { store } = makeTestStore();
    store.dispatch(setEndingCard('shown'));
    store.dispatch(requestEnding());
    expect(endingOf(store)).toBe('shown');
  });

  test('showEnding shows it and stores the flag; closeEnding closes it and the flag stays', () => {
    inView('full');
    const { store } = makeTestStore();
    store.dispatch(requestEnding());
    store.dispatch(showEnding());
    expect(endingOf(store)).toBe('shown');
    expect(store.getState().settingsDataState.isFullViewEndingSeen).toBe(true);
    expect(store.getState().settingsDataState.isPopupEndingSeen).toBe(false);
    expect(storedFlags()).toMatchObject({ isFullViewEndingSeen: true });

    store.dispatch(closeEnding());
    expect(endingOf(store)).toBeNull();
    expect(storedFlags()).toMatchObject({ isFullViewEndingSeen: true });
    store.dispatch(requestEnding());
    expect(endingOf(store)).toBeNull();
  });

  test('the popup stores its own flag', () => {
    inView('popup');
    const { store } = makeTestStore();
    store.dispatch(requestEnding());
    store.dispatch(showEnding());
    expect(storedFlags()).toMatchObject({
      isPopupEndingSeen: true,
      isFullViewEndingSeen: false,
    });
  });

  test('showEnding with nothing asked for shows nothing', () => {
    inView('full');
    const { store } = makeTestStore();
    store.dispatch(showEnding());
    expect(endingOf(store)).toBeNull();
    expect(store.getState().settingsDataState.isFullViewEndingSeen).toBe(false);
  });

  test('shown elsewhere while pending here: it is dropped, not shown', () => {
    inView('full');
    const { store } = makeTestStore();
    store.dispatch(requestEnding());
    // Another full-view page showed it; its write reached this page.
    store.dispatch(markEndingSeen('full'));
    store.dispatch(showEnding());
    expect(endingOf(store)).toBeNull();
  });
});
