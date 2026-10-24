import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

// Firebase is the only reason App cannot just be mounted (see appSessionsPermissionWiring.test.tsx).
vi.mock('../../config/firebase', () => ({
  // The yes turns sync on, and App starts the cloud session.
  ensureCloudSession: () => {},
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
  isCloudConfigured: false,
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import { readDeviceId } from '../../redux/deviceId';

// KAN-599. The device id is the Firestore doc id, a uuid in chrome.storage.sync
// that Chrome Sync carries to the user's other machines. A new machine used to
// mint its own at the first open, before Chrome Sync had brought the other
// machine's, and no open page took a later one: the first sync after the yes
// read an empty doc. Now none is minted before the yes, and every open page
// follows the stored id.

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const storedId = async () =>
  (await chrome.storage.sync.get(['tokenValue'])).tokenValue;

const idState = (
  store: Awaited<ReturnType<typeof renderWithProviders>>['store']
) => {
  const { isSignedIn, userId, awaitsDeviceId } = store.getState().globalState;
  return { isSignedIn, userId, awaitsDeviceId };
};

// A few task turns, for a negative: whatever the open would do has had its chance.
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });

describe('the device id (KAN-599)', () => {
  test('a fresh install writes no id before the yes, and waits for one', async () => {
    const { store } = await renderWithProviders(<App />);
    await waitFor(() => expect(idState(store).awaitsDeviceId).toBe(true));
    await settle();
    expect(idState(store)).toEqual({
      isSignedIn: false,
      userId: null,
      awaitsDeviceId: true,
    });
    expect(await storedId()).toBeUndefined();
  });

  test('the yes mints an id, stores it and adopts it', async () => {
    const { store } = await renderWithProviders(<App />);
    await waitFor(() => expect(idState(store).awaitsDeviceId).toBe(true));
    act(() => {
      store.dispatch(grantCloudConsent());
    });
    await waitFor(() => expect(idState(store).userId).not.toBeNull());
    expect(await storedId()).toBe(idState(store).userId);
    expect(idState(store)).toMatchObject({
      isSignedIn: true,
      awaitsDeviceId: false,
    });
  });

  test('an id Chrome Sync brings before the yes is adopted, and the yes mints none', async () => {
    const { store } = await renderWithProviders(<App />);
    await waitFor(() => expect(idState(store).awaitsDeviceId).toBe(true));
    await act(() => chrome.storage.sync.set({ tokenValue: 'Y-from-A' }));
    await waitFor(() => expect(idState(store).userId).toBe('Y-from-A'));
    act(() => {
      store.dispatch(grantCloudConsent());
    });
    await settle();
    expect(await storedId()).toBe('Y-from-A');
    expect(idState(store)).toEqual({
      isSignedIn: true,
      userId: 'Y-from-A',
      awaitsDeviceId: false,
    });
  });

  test('with the yes already given, an install with no id mints one at the open', async () => {
    const { store } = await renderWithProviders(<App />, {
      seedStore: (s) => {
        s.dispatch(grantCloudConsent());
      },
    });
    await waitFor(() => expect(idState(store).userId).not.toBeNull());
    expect(await storedId()).toBe(idState(store).userId);
  });

  test('a stored id is used at the open and none is minted', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: { storage: { tokenValue: 'X' } },
    });
    await waitFor(() => expect(idState(store).userId).toBe('X'));
    await settle();
    expect(await storedId()).toBe('X');
    expect(idState(store).isSignedIn).toBe(true);
  });

  test('an open page follows an id that arrives later', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: { storage: { tokenValue: 'X' } },
    });
    await waitFor(() => expect(idState(store).userId).toBe('X'));
    await act(() => chrome.storage.sync.set({ tokenValue: 'Y' }));
    await waitFor(() => expect(idState(store).userId).toBe('Y'));
    expect(idState(store).isSignedIn).toBe(true);
  });

  test('a removed or unusable id is not followed: the page keeps the one it has', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: { storage: { tokenValue: 'X' } },
    });
    await waitFor(() => expect(idState(store).userId).toBe('X'));
    await act(() => chrome.storage.sync.remove('tokenValue'));
    await settle();
    expect(idState(store).userId).toBe('X');
    await act(() => chrome.storage.sync.set({ tokenValue: 0 }));
    await settle();
    expect(idState(store).userId).toBe('X');
    // CONTROL: the same listener follows a usable one.
    await act(() => chrome.storage.sync.set({ tokenValue: 'Y' }));
    await waitFor(() => expect(idState(store).userId).toBe('Y'));
  });

  test('an unusable stored id is kept, nothing is minted, and the page waits for no id', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: { storage: { tokenValue: 0 } },
      seedStore: (s) => {
        s.dispatch(grantCloudConsent());
      },
    });
    await settle();
    expect(idState(store)).toEqual({
      isSignedIn: false,
      userId: null,
      awaitsDeviceId: false,
    });
    expect(await storedId()).toBe(0);
  });
});

// KAN-750 R19. Until the open's read lands nothing may say sync is unavailable, so every outcome ends the wait, and only after the outcome is in the store.
describe('the open read of the device id ends whatever it finds', () => {
  async function readAtOpen(seed: ChromeSeed, readFails = false) {
    const { store } = await renderWithProviders(<div />, { seed });
    if (readFails) {
      vi.spyOn(chrome.storage.sync, 'get').mockRejectedValue(
        new Error('unreadable')
      );
    }
    const before = store.getState().globalState.hasReadDeviceId;
    let atEnd: ReturnType<typeof idState> | null = null;
    const unsubscribe = store.subscribe(() => {
      if (atEnd === null && store.getState().globalState.hasReadDeviceId) {
        atEnd = idState(store);
      }
    });
    await act(() => store.dispatch(readDeviceId()));
    unsubscribe();
    return { before, atEnd, after: idState(store) };
  }

  test.each([
    ['a stored id', { storage: { tokenValue: 'X' } }, false, true, false],
    ['no id yet', {}, false, false, true],
    ['an unusable id', { storage: { tokenValue: 0 } }, false, false, false],
    ['a read that throws', {}, true, false, false],
  ])('%s', async (_name, seed, readFails, isSignedIn, awaitsDeviceId) => {
    const { before, atEnd, after } = await readAtOpen(seed, readFails);
    expect(before).toBe(false);
    expect(after).toMatchObject({ isSignedIn, awaitsDeviceId });
    expect(atEnd).toEqual(after);
  });
});
