import { afterEach, describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

const mocks = vi.hoisted(() => ({
  loadFromFirestore: vi.fn(async (): Promise<unknown> => undefined),
  saveToFirestore: vi.fn<
    (userId: string, data: TabMasterContainer) => Promise<void>
  >(async () => undefined),
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
  mocks.saveToFirestore.mock.calls.map(([, data]) => data.tabGroups[0].title);

function signedInStore() {
  const container = buildContainer([
    buildSession({ tabGroupId: 's-1', title: 'Reading' }),
  ]);
  mocks.loadFromFirestore.mockResolvedValue(structuredClone(container));
  mocks.saveToFirestore.mockClear();
  const { store } = makeTestStore();
  store.dispatch(replaceState(container));
  store.dispatch(setSignedIn());
  store.dispatch(setFirebaseAuthed());
  store.dispatch(setUserId('u1'));
  store.dispatch(grantCloudConsent());
  return store;
}

async function renameRefusedThenSync(store: ReturnType<typeof signedInStore>) {
  refusal = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('refused', 'QuotaExceededError');
  });
  vi.useFakeTimers();
  store.dispatch(
    updateTabGroupTitle({ tabGroupId: 's-1', editableTitle: 'Reading list' })
  );
  // The debounced sync the edit starts, and its cloud read and write.
  await vi.advanceTimersByTimeAsync(DEBOUNCE_TIME_WINDOW + 1);
}

describe('a sync after a refused save (KAN-593)', () => {
  test('keeps the change on screen and sends it to the cloud', async () => {
    const store = signedInStore();
    await renameRefusedThenSync(store);

    expect(mocks.loadFromFirestore).toHaveBeenCalled();
    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'Reading list'
    );
    expect(sentTitles()).toEqual(['Reading list']);
  });

  // Unreadable storage is no copy at all; the page's is the one to keep.
  test('keeps the change when localStorage is also unreadable', async () => {
    const store = signedInStore();
    localStorage.setItem('tabContainerData', '{"not":"a container"}');
    await renameRefusedThenSync(store);

    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'Reading list'
    );
    expect(sentTitles()).toEqual(['Reading list']);
  });
});
