import { afterEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({
  loadFromFirestore: vi.fn(async (): Promise<unknown> => undefined),
  saveToFirestore: vi.fn<(userId: string, data: unknown) => Promise<void>>(
    async () => undefined
  ),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
}));

import { makeTestStore } from '../setup/makeStore';
import {
  setFirebaseAuthed,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import {
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-593. The sync after an edit merges this device's copy with the cloud's.
// While a save is refused, localStorage is older than the page: merging it put
// the older copy back on screen and never sent the edit.

let refusal: { mockRestore(): void } | null = null;

afterEach(() => {
  refusal?.mockRestore();
  refusal = null;
  localStorage.clear();
  vi.useRealTimers();
});

const sentTitles = () =>
  mocks.saveToFirestore.mock.calls.map(
    ([, data]) => (data as TabMasterContainer).tabGroups[0].title
  );

describe('a sync after a refused save (KAN-593)', () => {
  test('keeps the change on screen and sends it to the cloud', async () => {
    const container = buildContainer([
      buildSession({ tabGroupId: 's-1', title: 'Reading' }),
    ]);
    mocks.loadFromFirestore.mockResolvedValue(structuredClone(container));
    const { store } = makeTestStore();
    store.dispatch(replaceState(container));
    store.dispatch(setSignedIn());
    store.dispatch(setFirebaseAuthed());
    store.dispatch(setUserId('u1'));
    store.dispatch(grantCloudConsent());
    refusal = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('refused', 'QuotaExceededError');
    });
    vi.useFakeTimers();

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 's-1', editableTitle: 'Reading list' })
    );
    // The debounced sync the edit starts, and its cloud read and write.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_TIME_WINDOW + 1);

    expect(mocks.loadFromFirestore).toHaveBeenCalled();
    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'Reading list'
    );
    expect(sentTitles()).toEqual(['Reading list']);
  });
});
