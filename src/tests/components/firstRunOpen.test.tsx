import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { firstOpenDialogs } from '../../redux/firstOpenDialogs';
import { openFirstDialog } from '../../utils/functions/dialogQueue';
import { makeTestStore } from '../setup/makeStore';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { setupChromeFake } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { asFirstRun, newRun } from '../../utils/functions/firstRun';
import { RUN_LOCK, holdTourLock } from '../../utils/functions/tourLock';
import {
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
  test('a running popup run resumes in the popup, and the queue stands down after it', async () => {
    const { store, opened, check } = await openWith('popup', {
      cloudConsent: 'granted',
      firstRun: { ...newRun('popup', 4), sessionId: 's' },
    });
    expect([opened, check]).toEqual(['firstRun', 'resumed']);
    await expect.poll(() => store.getState().globalState.isRunHere).toBe(true);
    expect(locks.held.has(RUN_LOCK)).toBe(true);
  });

  test('held by another page: left alone (R1)', async () => {
    await holdTourLock(RUN_LOCK);
    const { store, check } = await openWith('popup', {
      cloudConsent: 'granted',
      firstRun: newRun('popup', 4),
    });
    expect(check).toBe('elsewhere');
    expect(store.getState().globalState.isRunHere).toBe(false);
  });

  test('Q7: the welcome reshows once, counted; the third open ends it unanswered', async () => {
    const second = await openWith('popup', {
      cloudConsent: 'declined',
      firstRun: newRun('popup', 0),
    });
    expect(second.check).toBe('reshown');
    await expect
      .poll(() => second.store.getState().globalState.isCloudConsentModalOpen)
      .toBe(true);
    expect(second.store.getState().globalState.cloudConsentVariant).toBe(
      'welcome'
    );
    expect(
      second.store.getState().settingsDataState.firstRun?.welcomeShows
    ).toBe(2);
    locks.dropAll();
    const third = await openWith('popup', {
      cloudConsent: 'declined',
      firstRun: { ...newRun('popup', 0), welcomeShows: 2 },
    });
    expect(third.check).toBe('unanswered');
    expect(third.store.getState().settingsDataState.firstRun?.ended).toBe(
      'unanswered'
    );
    expect(third.store.getState().globalState.isCloudConsentModalOpen).toBe(
      false
    );
  });

  test('an upgrader’s full view starts What’s new at Hello', async () => {
    const { store, check } = await openWith(
      'full',
      { cloudConsent: 'granted' },
      3
    );
    expect(check).toBe('started');
    await expect
      .poll(() => store.getState().settingsDataState.firstRun)
      .toEqual(newRun('full', 0, 'whatsNew'));
  });

  test('Q8: a never-saved 1.9 user’s popup gets the welcome, setup begins, and the consent answer stays', async () => {
    const { store, seen } = await openWith(
      'popup',
      { cloudConsent: 'granted' },
      0
    );
    await expect
      .poll(() => store.getState().globalState.isCloudConsentModalOpen)
      .toBe(true);
    expect(store.getState().settingsDataState.setupState).toBe('pending');
    expect(store.getState().settingsDataState.firstRun).toEqual(
      newRun('popup', 0)
    );
    expect(seen).not.toContain('settingsDataState/declineCloudConsent');
  });

  test('R13: a new install’s first full-view visit replaces a popup run and deletes nothing', async () => {
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
      .toEqual(newRun('full', 0, 'welcome'));
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['sample:x']);
  });

  test('the answered e2e profile opens no run, and the rest of the queue decides', async () => {
    const { check, opened } = await openWith('popup', {
      cloudConsent: 'granted',
      isWhatsNew2Seen: true,
    });
    expect(check).toBe('none');
    expect(opened).not.toBe('firstRun');
  });
});
