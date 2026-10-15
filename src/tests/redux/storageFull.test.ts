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
import { hydrateSessionsFromStorage } from '../../redux/otherPageChanges';
import { TOMBSTONE_TTL_MS } from '../../utils/functions/mergeTabData';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { isValidTabMasterContainer } from '../../utils/functions/local';
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

// The re-reads that assume localStorage equals the page: a drop's, and another
// page's storage event. While a save is refused, the page is newer.
describe('a re-read of localStorage after a refused save (KAN-593)', () => {
  const OTHER = buildSession({ tabGroupId: 's-2', title: 'Other' });

  function seededTwo(
    deletedTabGroups: { tabGroupId: string; deletedAt: number }[] = []
  ) {
    const { store } = makeTestStore();
    store.dispatch(
      replaceState({ ...buildContainer([SESSION, OTHER]), deletedTabGroups })
    );
    return store;
  }

  const titles = (store: ReturnType<typeof seeded>) =>
    store.getState().tabContainerDataState.tabGroups.map((g) => g.title);

  // Another page's save, which lands: it writes localStorage directly.
  function otherPageRenames(
    id: string,
    title: string,
    lastModified = Date.now() + 60_000
  ) {
    refusal?.mockRestore();
    refusal = null;
    const stored: unknown = JSON.parse(
      localStorage.getItem('tabContainerData') ?? 'null'
    );
    if (!isValidTabMasterContainer(stored)) throw new Error('nothing stored');
    for (const g of stored.tabGroups) {
      if (g.tabGroupId === id) {
        g.title = title;
        g.lastModified = lastModified;
      }
    }
    localStorage.setItem('tabContainerData', JSON.stringify(stored));
  }

  test("a drop's re-read keeps the change, and its undo", () => {
    const store = seededTwo();
    refuseWrites('QuotaExceededError');
    store.dispatch(rename('Reading list'));
    const past = store.getState().undoRedo.past.length;

    store.dispatch(hydrateSessionsFromStorage());

    expect(titles(store)).toEqual(['Reading list', 'Other']);
    expect(store.getState().undoRedo.past.length).toBe(past);
  });

  // The merge prunes a grave past its time; the page still holds it. Storage
  // adds nothing, so the re-read is a no-op, not a reload that ends the undo.
  test("a drop's re-read keeps the undo when the page holds an expired grave", () => {
    const store = seededTwo([
      {
        tabGroupId: 's-old',
        deletedAt: Date.now() - TOMBSTONE_TTL_MS - 86_400_000,
      },
    ]);
    refuseWrites('QuotaExceededError');
    store.dispatch(rename('Reading list'));
    const before = store.getState().tabContainerDataState;
    const past = store.getState().undoRedo.past.length;

    store.dispatch(hydrateSessionsFromStorage());

    expect(store.getState().tabContainerDataState).toBe(before);
    expect(store.getState().undoRedo.past.length).toBe(past);
  });

  test("another page's save comes in beside the change", () => {
    const store = seededTwo();
    refuseWrites('QuotaExceededError');
    store.dispatch(rename('Reading list'));
    otherPageRenames('s-2', 'Other, renamed');

    store.dispatch(hydrateSessionsFromStorage());

    expect(titles(store)).toEqual(['Reading list', 'Other, renamed']);
  });

  // Control: once a save lands, localStorage is the page again and is taken as
  // it is -- even a write stamped older than the page's (another page's undo),
  // which a merge would refuse.
  test('after a save lands, a re-read takes localStorage as it is', () => {
    const store = seededTwo();
    const refused = refuseWrites('QuotaExceededError');
    store.dispatch(rename('Reading list'));
    refused.mockRestore();
    refusal = null;
    store.dispatch(rename('Reading list 2'));
    otherPageRenames('s-1', 'Renamed elsewhere', 1);

    store.dispatch(hydrateSessionsFromStorage());

    expect(titles(store)).toEqual(['Renamed elsewhere', 'Other']);
  });
});
