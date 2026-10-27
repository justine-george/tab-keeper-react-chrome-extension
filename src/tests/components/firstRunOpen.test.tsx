import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { firstOpenDialogs } from '../../redux/firstOpenDialogs';
import { openFirstDialog } from '../../utils/functions/dialogQueue';
import { makeTestStore } from '../setup/makeStore';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { setupChromeFake } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  asFirstRun,
  newFullViewStepsRun,
  newRun,
} from '../../utils/functions/firstRun';
import {
  beginSetup,
  recordFirstRun,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import type { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';

// §11 and §12: what the firstRun entry does on each open, and that the queue stands down after it.

let locks: FakeLocks;
beforeEach(() => {
  locks = installFakeLocks();
  setupChromeFake({});
});
afterEach(() => {
  locks.uninstall();
  localStorage.clear();
  history.replaceState(null, '', '?');
  delete document.documentElement.dataset.runCheck;
});

async function openWith(
  surface: 'popup' | 'full',
  storedAtOpen: Partial<SettingsData>,
  storedSessions = 0,
  sessions?: TabMasterContainer
) {
  if (surface === 'full') history.replaceState(null, '', '?view=tab');
  const { store, seen } = makeTestStore();
  // In the app the store and storedAtOpen come from the same disk.
  const record = asFirstRun(storedAtOpen.firstRun);
  if (record !== null) store.dispatch(recordFirstRun(record));
  if (storedAtOpen.setupState === 'pending') store.dispatch(beginSetup());
  if (sessions !== undefined) store.dispatch(replaceState(sessions));
  const entries = firstOpenDialogs(surface, {
    dispatch: store.dispatch,
    storedAtOpen,
    storedSessions,
    getState: store.getState,
  });
  const opened = await openFirstDialog(
    entries,
    () => store.getState().globalState.hasRunShownHere
  );
  return {
    store,
    seen,
    opened,
    check: document.documentElement.dataset.runCheck,
  };
}

describe('the firstRun entry', () => {
  // R1 only leaves the run alone: a browser with no lock answer must still get setup.
  test('CONTROL: no lock answer: the queue goes on, and setup opens', async () => {
    locks.uninstall();
    locks = installFakeLocks({ queryRejects: true });
    const { store, opened, check } = await openWith('full', {
      cloudConsent: 'granted',
      isWhatsNew2Seen: true,
      setupState: 'pending',
      firstRun: newRun('full', 4),
    });
    expect([check, opened]).toEqual(['unknown', 'setup']);
    expect(store.getState().globalState.isSetupOpen).toBe(true);
  });

  // KAN-451. The answer was recorded at the first opening; a reshow only shows the welcome again.
  test('a welcome reshow writes no consent answer; the first opening does', async () => {
    const consentWrites = (seen: string[]) =>
      seen.filter((type) => /(grant|decline)CloudConsent/.test(type));
    const first = await openWith('popup', {});
    await expect
      .poll(() => first.store.getState().globalState.isCloudConsentModalOpen)
      .toBe(true);
    expect(consentWrites(first.seen)).toHaveLength(1);
    locks.dropAll();
    const reshow = await openWith('popup', {
      cloudConsent: 'declined',
      firstRun: { ...newRun('popup', 0), welcomeShows: 1 },
    });
    expect(reshow.check).toBe('reshown');
    await expect
      .poll(() => reshow.store.getState().globalState.isCloudConsentModalOpen)
      .toBe(true);
    expect(consentWrites(reshow.seen)).toEqual([]);
  });

  test('R13, KAN-830: a new install’s first full-view visit replaces a running popup run with the short tour, carrying its example, and deletes nothing yet', async () => {
    const sample = buildSession({ tabGroupId: 'sample:x', title: 'Sample' });
    const { store, check } = await openWith(
      'full',
      {
        cloudConsent: 'declined',
        setupState: 'pending',
        firstRun: { ...newRun('popup', 3), sessionId: 'sample:x' },
      },
      1,
      buildContainer([sample])
    );
    expect(check).toBe('started');
    await expect
      .poll(() => store.getState().settingsDataState.firstRun)
      .toEqual(newFullViewStepsRun('sample:x'));
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['sample:x']);
  });
});
