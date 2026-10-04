import { afterEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

import { firstOpenDialogs } from '../../redux/firstOpenDialogs';
import { makeTestStore } from '../setup/makeStore';

// KAN-7 §8. Which dialogs each surface asks about, in order. Tasks 7-10
// each add one id here, and that edit is their RED.

const listFor = (surface: 'popup' | 'full') => {
  const { store } = makeTestStore();
  return firstOpenDialogs(surface, {
    dispatch: store.dispatch,
    storedAtOpen: {},
    storedSessions: 0,
    getState: store.getState,
  }).map((e) => e.id);
};

afterEach(() => localStorage.clear());

describe('the first-open lists', () => {
  test('popup', () => {
    expect(listFor('popup')).toEqual([
      'cloudConsent',
      'fullViewOffer',
      'rate',
      'tabGroups',
      'fullViewCallout',
    ]);
  });

  test('full view', () => {
    expect(listFor('full')).toEqual([
      'cloudConsent',
      'pinGuide',
      'setup',
      'rate',
      'tabGroups',
    ]);
  });
});

describe('the cloud question entry (KAN-259, moved from App)', () => {
  // The worst path: answered by the setting they already had, never asked.
  test.each([
    ['a past sync', { lastSyncedTime: Date.now() - 1 }, 0],
    ['sessions on disk', {}, 2],
  ])(
    'an existing user (%s) with Auto Sync off is recorded as declined, and nothing opens',
    async (_, stored, storedSessions) => {
      const { store } = makeTestStore();
      const [cloudConsent] = firstOpenDialogs('popup', {
        dispatch: store.dispatch,
        storedAtOpen: { ...stored, isAutoSync: false },
        storedSessions,
        getState: store.getState,
      });
      expect(await cloudConsent.decide()).toBeNull();
      expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
    }
  );

  test('sessions on disk make a user existing even with no install date', async () => {
    const { store } = makeTestStore();
    const [cloudConsent] = firstOpenDialogs('popup', {
      dispatch: store.dispatch,
      storedAtOpen: {},
      storedSessions: 2,
      getState: store.getState,
    });
    const open = await cloudConsent.decide();
    open?.();
    expect(store.getState().globalState.cloudConsentVariant).toBe('existing');
  });

  test('a past sync makes a user existing with no sessions on disk', async () => {
    const { store } = makeTestStore();
    const [cloudConsent] = firstOpenDialogs('popup', {
      dispatch: store.dispatch,
      storedAtOpen: { lastSyncedTime: Date.now() - 1 },
      storedSessions: 0,
      getState: store.getState,
    });
    const open = await cloudConsent.decide();
    open?.();
    expect(store.getState().globalState.cloudConsentVariant).toBe('existing');
    expect(store.getState().settingsDataState.cloudConsent).toBe('');
  });

  // KAN-410. A 1.9.x welcome closed unanswered left only an install date.
  test('an install date alone is a new user: welcomed, and recorded declined', async () => {
    const { store } = makeTestStore();
    const [cloudConsent] = firstOpenDialogs('popup', {
      dispatch: store.dispatch,
      storedAtOpen: {
        extensionInstalledTime: Date.now() - 30 * 24 * 60 * 60 * 1000,
        cloudConsent: '',
        isAutoSync: true,
      },
      storedSessions: 0,
      getState: store.getState,
    });
    const open = await cloudConsent.decide();
    open?.();
    expect(store.getState().globalState.cloudConsentVariant).toBe('welcome');
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    expect(store.getState().settingsDataState.setupState).toBe('pending');
  });
});
