import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  openAllTabContainer,
  openTabsInAWindow,
  saveToTabContainer,
  isSubstantialSave,
} from '../../redux/slices/tabContainerDataStateSlice';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';
import { noteReviewMoment, showReviewCard } from '../../redux/reviewAsk';
import {
  setSkippedUserReviewOnce,
  setUserRatedAndReviewed,
} from '../../redux/slices/settingsDataStateSlice';
import { REVIEW_ASK_GAP_MS } from '../../utils/functions/reviewAsk';

// KAN-149, KAN-653. What counts as the extension having visibly paid off, and
// which card each payoff asks with.
//
// These are the writes the review card reads. Each is asserted at the store,
// because the gate (reviewAsk.test.ts) is pure and cannot see whether anything
// ever calls it -- a trigger that never fires would leave that suite green.

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 10, 12, 0, 0);

const session = (id: string, tabCount: number) => ({
  tabGroupId: id,
  title: id.toUpperCase(),
  createdTime: '2026-09-10 12:00:00',
  createdAt: T0,
  windowCount: 1,
  tabCount,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `${id}-w`,
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount,
      title: 'Window',
      tabs: Array.from({ length: tabCount }, (_, i) => ({
        tabId: `${id}-t${i}`,
        favicon: '',
        title: `Tab ${i}`,
        url: 'https://a.co',
      })),
    },
  ],
});

const momentOf = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().settingsDataState.pendingReviewAsk?.moment.kind ?? null;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  // The restore thunks hand off to the service worker, which does not exist
  // here. Only the dispatch before it is under test.
  globalThis.chrome = {
    ...(globalThis.chrome ?? {}),
    runtime: { sendMessage: vi.fn() },
  } as unknown as typeof chrome;
});

describe('restoring a session asks "Your tabs are back"', () => {
  test('opening every window notes one', async () => {
    const { store } = makeTestStore();
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('a', 3),
    });
    expect(momentOf(store)).toBeNull();

    await store.dispatch(
      openAllTabContainer({ tabGroupId: 'a', goToURLText: 'Go to URL' })
    );

    expect(momentOf(store)).toBe('restored');
  });

  test('opening a single window notes one', async () => {
    const { store } = makeTestStore();
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('a', 3),
    });

    await store.dispatch(
      openTabsInAWindow({
        tabGroupId: 'a',
        windowId: 'a-w',
        goToURLText: 'Go to URL',
      })
    );

    expect(momentOf(store)).toBe('restored');
  });

  // The guard clause above the dispatch has to hold: a restore of something
  // that is not there did nothing for the user and must not be spent.
  test('a restore of a session that does not exist notes nothing', async () => {
    const { store } = makeTestStore();

    await store.dispatch(
      openAllTabContainer({ tabGroupId: 'missing', goToURLText: 'Go to URL' })
    );

    expect(momentOf(store)).toBeNull();
  });
});

// KAN-150. Sized against the user's own library rather than a constant.
const seedSizes = (
  store: ReturnType<typeof makeTestStore>['store'],
  sizes: number[]
) =>
  sizes.forEach((n, i) =>
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session(`seed${i}`, n),
    })
  );

describe('a save asks "Your tabs are saved" only when it is substantial for this user', () => {
  test('a save larger than their median notes one', async () => {
    const { store } = makeTestStore();
    seedSizes(store, [2, 3, 4]); // median 3
    localStorage.clear();

    await store.dispatch(
      saveToTabContainer({ container: session('big', 5), scope: 'all-windows' })
    );

    expect(momentOf(store)).toBe('bigSave');
  });

  // THE CONTROL. The same five-tab save, for someone who saves far more --
  // proof this is relative rather than a constant wearing a new name. A fixed
  // threshold could not tell these two cases apart.
  test('CONTROL: the same save records nothing for a heavier user', async () => {
    const { store } = makeTestStore();
    seedSizes(store, [30, 40, 50]); // median 40

    await store.dispatch(
      saveToTabContainer({ container: session('big', 5), scope: 'all-windows' })
    );

    expect(momentOf(store)).toBeNull();
  });

  test('a save at exactly the median notes nothing', async () => {
    const { store } = makeTestStore();
    seedSizes(store, [4, 6, 8]); // median 6

    await store.dispatch(
      saveToTabContainer({
        container: session('same', 6),
        scope: 'all-windows',
      })
    );

    expect(momentOf(store)).toBeNull();
  });

  // The library is read BEFORE the new session joins it, and this is the case
  // that can tell. Against [1, 10] the median is 5.5 and a six-tab save wins;
  // once the six is a member, [1, 6, 10] has median 6 and it ties, which loses.
  // Every other size pairing gives the same answer either way.
  test('measures against the library as it was before this save', async () => {
    const { store } = makeTestStore();
    seedSizes(store, [1, 10]);

    await store.dispatch(
      saveToTabContainer({ container: session('six', 6), scope: 'all-windows' })
    );

    expect(momentOf(store)).toBe('bigSave');
  });

  // KAN-653. Not "substantial" -- there is nothing to measure against -- but
  // the first session kept is its own payoff, and asks with its own words.
  test('the very first save asks "Your first session is saved"', async () => {
    const { store } = makeTestStore();

    await store.dispatch(
      saveToTabContainer({
        container: session('first', 1),
        scope: 'all-windows',
      })
    );

    expect(momentOf(store)).toBe('firstSave');
  });

  test('the second save is not a first save', async () => {
    const { store } = makeTestStore();
    seedSizes(store, [3]);
    localStorage.clear();

    await store.dispatch(
      saveToTabContainer({ container: session('two', 1), scope: 'all-windows' })
    );

    expect(momentOf(store)).toBeNull();
  });
});

describe('isSubstantialSave', () => {
  const lib = (...sizes: number[]) =>
    sizes.map((n, i) => session(`s${i}`, n)) as never;

  test('an empty library is never a payoff', () => {
    expect(isSubstantialSave(100, [])).toBe(false);
  });

  test('takes the middle of an odd-sized library', () => {
    expect(isSubstantialSave(6, lib(1, 5, 9))).toBe(true);
    expect(isSubstantialSave(5, lib(1, 5, 9))).toBe(false);
  });

  // Averaged, not "the one to the left". With [2,4,6,8] the median is 5, so a
  // five-tab save is NOT larger -- picking counts[1] would have called it one.
  test('averages the middle two of an even-sized library', () => {
    expect(isSubstantialSave(5, lib(2, 4, 6, 8))).toBe(false);
    expect(isSubstantialSave(6, lib(2, 4, 6, 8))).toBe(true);
  });

  // The counts are SORTED before the middle is taken. [1, 9, 5] is chosen
  // deliberately: unsorted, its middle element is 9 and a six-tab save loses;
  // sorted, the median is 5 and it wins. Comparing [9, 1, 5] against [1, 5, 9]
  // -- the obvious pair -- cannot see this, because 6 beats the middle of both.
  test('sorts before taking the middle, whatever order they arrive in', () => {
    expect(isSubstantialSave(6, lib(1, 9, 5))).toBe(true);
    expect(isSubstantialSave(6, lib(1, 5, 9))).toBe(true);
    expect(isSubstantialSave(6, lib(9, 5, 1))).toBe(true);
  });
});

describe('the noted ask', () => {
  test('is written to localStorage, since the popup is about to close', async () => {
    const { store } = makeTestStore();
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('a', 3),
    });

    await store.dispatch(
      openAllTabContainer({ tabGroupId: 'a', goToURLText: 'Go to URL' })
    );

    const stored = JSON.parse(localStorage.getItem('settingsData') ?? '{}');
    expect(stored.pendingReviewAsk).toEqual(
      store.getState().settingsDataState.pendingReviewAsk
    );
    expect(stored.pendingReviewAsk.moment).toEqual({ kind: 'restored' });
  });

  test('moves forward when a newer moment happens', async () => {
    const { store } = makeTestStore();
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('a', 3),
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      await store.dispatch(
        openAllTabContainer({ tabGroupId: 'a', goToURLText: 'Go to URL' })
      );
      const atOf = () =>
        store.getState().settingsDataState.pendingReviewAsk?.at;
      expect(atOf()).toBe(T0);

      vi.setSystemTime(T0 + HOUR);
      await store.dispatch(
        openAllTabContainer({ tabGroupId: 'a', goToURLText: 'Go to URL' })
      );

      expect(atOf()).toBe(T0 + HOUR);
    } finally {
      vi.useRealTimers();
    }
  });
});

// KAN-7. The run's example session is no save of the user's: restoring it must not spend the ask (KAN-149).
describe('the sample session is no moment', () => {
  const SAMPLE = `${SAMPLE_ID_PREFIX}abc`;
  const seed = (store: ReturnType<typeof makeTestStore>['store']) =>
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session(SAMPLE, 3),
    });

  test('opening every window of the sample notes nothing', async () => {
    const { store } = makeTestStore();
    seed(store);
    await store.dispatch(
      openAllTabContainer({ tabGroupId: SAMPLE, goToURLText: 'Go to URL' })
    );
    expect(momentOf(store)).toBeNull();
  });

  test('opening one window of the sample notes nothing', async () => {
    const { store } = makeTestStore();
    seed(store);
    await store.dispatch(
      openTabsInAWindow({
        tabGroupId: SAMPLE,
        windowId: `${SAMPLE}-w`,
        goToURLText: 'Go to URL',
      })
    );
    expect(momentOf(store)).toBeNull();
  });

  // The sample is not a session the user kept, so this is still their first.
  test('a first real save beside only the sample is a first save', async () => {
    const { store } = makeTestStore();
    seed(store);
    localStorage.clear();
    await store.dispatch(
      saveToTabContainer({
        container: session('real', 8),
        scope: 'all-windows',
      })
    );
    expect(momentOf(store)).toBe('firstSave');
  });

  // "Use an example" adds the sample without this thunk; this is the guard in
  // case anything ever saves one through it.
  test('saving the sample itself notes nothing', async () => {
    const { store } = makeTestStore();
    await store.dispatch(
      saveToTabContainer({
        container: session(`${SAMPLE_ID_PREFIX}new`, 8),
        scope: 'all-windows',
      })
    );
    expect(momentOf(store)).toBeNull();
  });

  test('CONTROL: the same save beside an ordinary one-tab session is a big save', async () => {
    const { store } = makeTestStore();
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('ordinary', 1),
    });
    localStorage.clear();
    await store.dispatch(
      saveToTabContainer({
        container: session('real', 8),
        scope: 'all-windows',
      })
    );
    expect(momentOf(store)).toBe('bigSave');
  });

  test('the sample is left out of the median, not just the empty case', async () => {
    const { store } = makeTestStore();
    seed(store); // 3 tabs
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('ordinary', 5),
    });
    localStorage.clear();
    // Median of [5] is 5 with the sample dropped (4 with it): 5 is not above it.
    await store.dispatch(
      saveToTabContainer({
        container: session('real', 5),
        scope: 'all-windows',
      })
    );
    expect(momentOf(store)).toBeNull();
  });
});

describe('isSubstantialSave and the sample', () => {
  test('a list holding only samples counts as empty', () => {
    expect(isSubstantialSave(9, [session(`${SAMPLE_ID_PREFIX}x`, 1)])).toBe(
      false
    );
  });
});

// KAN-653. A moment notes an ask only while one may be made: the card itself
// re-checks, but a pending ask the gate would refuse is one nobody should see.
describe('a moment while no ask is allowed', () => {
  test('notes nothing once the user has rated', async () => {
    const { store } = makeTestStore();
    store.dispatch(setUserRatedAndReviewed());
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('a', 3),
    });

    await store.dispatch(
      openAllTabContainer({ tabGroupId: 'a', goToURLText: 'Go to URL' })
    );

    expect(momentOf(store)).toBeNull();
  });

  // The gate is read from localStorage, not this page's store: another page
  // may have just asked, and its write reaches this store only later.
  test('notes nothing when another page asked inside the gap', () => {
    const { store } = makeTestStore();
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ lastReviewRequestTime: Date.now() - 1000 })
    );

    store.dispatch(noteReviewMoment({ kind: 'restored' }));

    expect(momentOf(store)).toBeNull();
  });
});

describe('showing the card', () => {
  const cardOf = (store: ReturnType<typeof makeTestStore>['store']) =>
    store.getState().globalState.reviewCard;

  test('opens it, stamps the ask and clears the pending one', () => {
    const { store } = makeTestStore();
    store.dispatch(noteReviewMoment({ kind: 'bigSave' }));

    store.dispatch(showReviewCard({ kind: 'bigSave' }));

    expect(cardOf(store)).toEqual({
      moment: { kind: 'bigSave' },
      offersNever: false,
    });
    const settings = store.getState().settingsDataState;
    expect(typeof settings.lastReviewRequestTime).toBe('number');
    expect(settings.pendingReviewAsk).toBeNull();
    expect(settings.isTimeAskDone).toBe(false);
    const stored = JSON.parse(localStorage.getItem('settingsData') ?? '{}');
    expect(stored.lastReviewRequestTime).toBe(settings.lastReviewRequestTime);
    expect(stored.pendingReviewAsk).toBeNull();
  });

  test('the time ask marks itself done', () => {
    const { store } = makeTestStore();

    store.dispatch(showReviewCard({ kind: 'time' }));

    expect(store.getState().settingsDataState.isTimeAskDone).toBe(true);
  });

  // KAN-861. Its control is the bigSave test above, where it stays false.
  test('the updated ask marks the time ask done', () => {
    const { store } = makeTestStore();

    store.dispatch(showReviewCard({ kind: 'updated' }));

    expect(store.getState().settingsDataState.isTimeAskDone).toBe(true);
  });

  test('offers "never" only to someone who has closed one before', () => {
    const { store } = makeTestStore();
    store.dispatch(setSkippedUserReviewOnce());

    store.dispatch(showReviewCard({ kind: 'restored' }));

    expect(cardOf(store)?.offersNever).toBe(true);
  });

  test('does not open inside the gap', () => {
    const { store } = makeTestStore();
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        lastReviewRequestTime: Date.now() - REVIEW_ASK_GAP_MS + 60_000,
      })
    );

    store.dispatch(showReviewCard({ kind: 'restored' }));

    expect(cardOf(store)).toBeNull();
  });

  // Review Focus 1: the popup over a full view. Both pages saw the moment;
  // only one may ask. B's own store still holds the settings it loaded with,
  // so only re-reading localStorage can tell it A has asked.
  test('a second page does not ask again once another page has asked', () => {
    const a = makeTestStore().store;
    const b = makeTestStore().store;
    a.dispatch(noteReviewMoment({ kind: 'sessionsArrived' }));
    b.dispatch(noteReviewMoment({ kind: 'sessionsArrived' }));

    a.dispatch(showReviewCard({ kind: 'sessionsArrived' }));
    b.dispatch(showReviewCard({ kind: 'sessionsArrived' }));

    expect(cardOf(a)).not.toBeNull();
    expect(cardOf(b)).toBeNull();
  });

  // B's store is stale. A write from it here would put back the empty
  // lastReviewRequestTime it loaded with, over A's stamp, and reopen the gate.
  test('a refused page writes nothing over the page that asked', () => {
    const a = makeTestStore().store;
    const b = makeTestStore().store;
    a.dispatch(showReviewCard({ kind: 'time' }));
    const afterA = localStorage.getItem('settingsData');

    b.dispatch(showReviewCard({ kind: 'time' }));

    expect(localStorage.getItem('settingsData')).toBe(afterA);
  });
});
