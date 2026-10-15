import { afterEach, describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import { toastTexts } from '../setup/toasts';
import { toastsRemoved } from '../../redux/slices/globalStateSlice';
import {
  replaceState,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-593. A save the localStorage quota refuses says so; the change stays on screen.

const SESSION = buildSession({ tabGroupId: 's-1', title: 'Reading' });

// Restored by hand: restoreAllMocks left this spy refusing into the next test.
let refusal: { mockRestore(): void } | null = null;
function refuseWrites(name: string) {
  refusal = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('refused', name);
  });
  return refusal;
}

function seeded() {
  const { store } = makeTestStore();
  store.dispatch(replaceState(buildContainer([SESSION])));
  return store;
}

const rename = (title: string) =>
  updateTabGroupTitle({ tabGroupId: 's-1', editableTitle: title });

const titleOf = (store: ReturnType<typeof seeded>) =>
  store.getState().tabContainerDataState.tabGroups[0].title;

const storedTitle = () =>
  JSON.parse(localStorage.getItem('tabContainerData') ?? 'null')?.tabGroups[0]
    .title;

afterEach(() => {
  refusal?.mockRestore();
  refusal = null;
  localStorage.clear();
});

describe('a save past the localStorage limit (KAN-593)', () => {
  test('shows the storage-full toast and keeps the change on screen', () => {
    const store = seeded();
    refuseWrites('QuotaExceededError');

    store.dispatch(rename('Reading list'));

    expect(toastTexts(store.getState())).toEqual([TOAST_MESSAGES.STORAGE_FULL]);
    expect(titleOf(store)).toBe('Reading list');
  });

  test('two refused saves show one toast', () => {
    const store = seeded();
    refuseWrites('QuotaExceededError');

    store.dispatch(rename('Reading list'));
    store.dispatch(rename('Reading list 2'));

    expect(toastTexts(store.getState())).toEqual([TOAST_MESSAGES.STORAGE_FULL]);
  });

  test('a save that lands after the toast is gone shows nothing', () => {
    const store = seeded();
    const refused = refuseWrites('QuotaExceededError');
    store.dispatch(rename('Reading list'));
    const [toast] = store.getState().globalState.toasts;
    store.dispatch(toastsRemoved([toast.id]));
    refused.mockRestore();

    store.dispatch(rename('Reading list 2'));

    expect(toastTexts(store.getState())).toEqual([]);
    expect(storedTitle()).toBe('Reading list 2');
  });

  // Only the quota is "storage is full"; any other refusal would make the toast lie.
  test('a refusal other than the quota shows no toast', () => {
    const store = seeded();
    refuseWrites('SecurityError');

    store.dispatch(rename('Reading list'));

    expect(toastTexts(store.getState())).toEqual([]);
  });

  test('a save that lands shows no toast', () => {
    const store = seeded();

    store.dispatch(rename('Reading list'));

    expect(toastTexts(store.getState())).toEqual([]);
    expect(storedTitle()).toBe('Reading list');
  });
});
