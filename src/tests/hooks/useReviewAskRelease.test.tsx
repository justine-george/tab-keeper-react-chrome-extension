import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';

import {
  REVIEW_CARD_SETTLE_MS,
  useReviewAskRelease,
} from '../../hooks/useReviewAskRelease';
import { askAtOpen, noteReviewMoment } from '../../redux/reviewAsk';
import { makeTestStore } from '../setup/makeStore';
import {
  closeReviewCard,
  closeFullViewCallout,
  openFullViewCallout,
  noteFirstSave,
  setFirstSavePopping,
  setEndingCard,
  closePinGuide,
  closeSetup,
  openPinGuide,
  openSetup,
  runShownHere,
  runStoppedHere,
} from '../../redux/slices/globalStateSlice';
import {
  PENDING_ASK_FRESH_MS,
  TIME_ASK_AFTER_MS,
} from '../../utils/functions/reviewAsk';

// KAN-653. A pending ask shows once nothing covers the page: no run, note,
// setup, pin guide, modal dialog or card, and the page has focus. Each check
// waits REVIEW_CARD_SETTLE_MS, so a gap between two covers -- setup closing,
// the pin guide opening after its toolbar read -- is not taken for a clear
// page.

// Each test starts on its own clock: a page remembers the asks it noted and
// released by their time, for the module's life, which here is the file's.
const START = Date.UTC(2026, 9, 16, 12, 0, 0);
let T0 = START;
const MINUTE = 60_000;

let hasFocus = true;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  T0 += 7 * 24 * 60 * MINUTE;
  vi.setSystemTime(T0);
  hasFocus = true;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => hasFocus);
});

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '?');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Mounted as on a page whose open has decided its dialogs, unless a test
// says otherwise and decides them later through `rerender`.
const mountWith = (
  seed?: (store: ReturnType<typeof makeTestStore>['store']) => void,
  areOpenDialogsDecided = true
) => {
  const { store } = makeTestStore();
  seed?.(store);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const { rerender } = renderHook(
    ({ decided }) => useReviewAskRelease(decided),
    { wrapper, initialProps: { decided: areOpenDialogsDecided } }
  );
  return { store, decide: () => rerender({ decided: true }) };
};
const mount = (
  seed?: (store: ReturnType<typeof makeTestStore>['store']) => void
) => mountWith(seed).store;

const cardOf = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().globalState.reviewCard;

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

// Another page's ask: written to localStorage the way that page's slice would.
const storeOtherPageAsk = (at: number) =>
  localStorage.setItem(
    'settingsData',
    JSON.stringify({ pendingReviewAsk: { moment: { kind: 'restored' }, at } })
  );

describe('releasing a pending ask', () => {
  test('a clear page shows it 300 ms after the check, not before', () => {
    const store = mount((s) =>
      s.dispatch(noteReviewMoment({ kind: 'bigSave' }))
    );

    advance(REVIEW_CARD_SETTLE_MS - 1);
    expect(cardOf(store)).toBeNull();

    advance(1);
    expect(cardOf(store)?.moment).toEqual({ kind: 'bigSave' });
  });

  test('waits out the run, then shows 300 ms after it stops', () => {
    const store = mount((s) => {
      s.dispatch(runShownHere());
      s.dispatch(noteReviewMoment({ kind: 'firstSave' }));
    });
    advance(5_000);
    expect(cardOf(store)).toBeNull();

    act(() => {
      store.dispatch(runStoppedHere());
    });
    advance(REVIEW_CARD_SETTLE_MS - 1);
    expect(cardOf(store)).toBeNull();
    advance(1);
    expect(cardOf(store)?.moment).toEqual({ kind: 'firstSave' });
  });

  test('setup closing and the pin guide opening 100 ms later is no clear page', () => {
    const store = mount((s) => {
      s.dispatch(openSetup());
      s.dispatch(noteReviewMoment({ kind: 'firstSave' }));
    });
    advance(1_000);

    act(() => {
      store.dispatch(closeSetup());
    });
    advance(100);
    act(() => {
      store.dispatch(openPinGuide());
    });
    advance(5_000);
    expect(cardOf(store)).toBeNull();

    act(() => {
      store.dispatch(closePinGuide());
    });
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)).not.toBeNull();
  });

  // componentSetup's showModal stub records what :modal would match (KAN-426).
  test('a modal dialog covers the page; closing it is a store change away', () => {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    const store = mount((s) =>
      s.dispatch(noteReviewMoment({ kind: 'bigSave' }))
    );

    advance(5_000);
    expect(cardOf(store)).toBeNull();

    dialog.close();
    dialog.remove();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)).not.toBeNull();
  });

  // One prompt at a time: the full-view callout is a card too.
  test('the full-view callout covers the page', () => {
    const store = mount((s) => {
      s.dispatch(openFullViewCallout());
      s.dispatch(noteReviewMoment({ kind: 'bigSave' }));
    });
    advance(5_000);
    expect(cardOf(store)).toBeNull();

    act(() => {
      store.dispatch(closeFullViewCallout());
    });
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)).not.toBeNull();
  });

  // KAN-875. The first save's pop plays first; its card comes after.
  test('the first-save pop covers the page', () => {
    const store = mount((s) => {
      s.dispatch(setFirstSavePopping(true));
      s.dispatch(noteReviewMoment({ kind: 'firstSave' }));
    });
    advance(5_000);
    expect(cardOf(store)).toBeNull();

    act(() => {
      store.dispatch(setFirstSavePopping(false));
    });
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)).not.toBeNull();
  });

  // KAN-879. The onboarding ending, asked for or on screen, comes first; the card after.
  test.each(['pending', 'shown'] as const)(
    'the ending card (%s) covers the page',
    (ending) => {
      const store = mount((s) => {
        s.dispatch(setEndingCard(ending));
        s.dispatch(noteReviewMoment({ kind: 'firstSave' }));
      });
      advance(5_000);
      expect(cardOf(store)).toBeNull();

      act(() => {
        store.dispatch(setEndingCard(null));
      });
      advance(REVIEW_CARD_SETTLE_MS);
      expect(cardOf(store)).not.toBeNull();
    }
  );

  // KAN-875. Only a pop on screen holds the card: a page with none never says it is popping.
  test('a first save with no pop on the page is not held', () => {
    const store = mount((s) => {
      s.dispatch(noteFirstSave());
      s.dispatch(noteReviewMoment({ kind: 'firstSave' }));
    });
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)).not.toBeNull();
  });

  // The open's dialog queue may still put a modal or the callout up. A
  // pending ask waits for it, so the two never share the page.
  test('waits until the open has decided its dialogs', () => {
    const { store, decide } = mountWith(
      (s) => s.dispatch(noteReviewMoment({ kind: 'time' })),
      false
    );
    advance(5_000);
    expect(cardOf(store)).toBeNull();

    act(() => decide());
    advance(REVIEW_CARD_SETTLE_MS - 1);
    expect(cardOf(store)).toBeNull();
    advance(1);
    expect(cardOf(store)).not.toBeNull();
  });

  // C3: a full-view restore opens focused windows over the page; it asks
  // when the person comes back to it.
  test('waits while the page has no focus, and shows when focus returns', () => {
    history.replaceState(null, '', '?view=tab');
    hasFocus = false;
    const store = mount((s) =>
      s.dispatch(noteReviewMoment({ kind: 'restored' }))
    );
    advance(60 * MINUTE);
    expect(cardOf(store)).toBeNull();

    hasFocus = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)?.moment).toEqual({ kind: 'restored' });
  });

  test('a page coming back to visible checks too', () => {
    history.replaceState(null, '', '?view=tab');
    hasFocus = false;
    const store = mount((s) =>
      s.dispatch(noteReviewMoment({ kind: 'restored' }))
    );
    advance(REVIEW_CARD_SETTLE_MS);

    hasFocus = true;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)).not.toBeNull();
  });

  test('another page’s ask 31 minutes old is not shown', () => {
    storeOtherPageAsk(T0 - PENDING_ASK_FRESH_MS - MINUTE);
    const store = mount();
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)).toBeNull();
  });

  test('CONTROL: another page’s ask 29 minutes old is shown', () => {
    storeOtherPageAsk(T0 - 29 * MINUTE);
    const store = mount();
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)?.moment).toEqual({ kind: 'restored' });
  });

  test('this page’s own ask is shown however old it is', () => {
    history.replaceState(null, '', '?view=tab');
    hasFocus = false;
    const store = mount((s) =>
      s.dispatch(noteReviewMoment({ kind: 'restored' }))
    );
    advance(5 * 60 * MINUTE);

    hasFocus = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)).not.toBeNull();
  });

  // Review I3. The popup that noted a restore is about to close as the
  // restored windows take focus; if that is slow, it must not spend the ask
  // on a card nobody will see. "Your tabs are back" is the next open's.
  test('a popup never shows a restore it noted itself', () => {
    const store = mount((s) =>
      s.dispatch(noteReviewMoment({ kind: 'restored' }))
    );
    advance(5_000);
    expect(cardOf(store)).toBeNull();
    expect(store.getState().settingsDataState.pendingReviewAsk?.moment).toEqual(
      { kind: 'restored' }
    );
  });

  test('CONTROL: the popup shows any other ask it noted', () => {
    const store = mount((s) =>
      s.dispatch(noteReviewMoment({ kind: 'firstSave' }))
    );
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)).not.toBeNull();
  });

  // Review I1. Settings that stop saving leave the old gate and the pending
  // ask in storage, where the release reads them. A card closed here must
  // not come straight back.
  test('an ask shown on this page is never shown here again', () => {
    const store = mount((s) =>
      s.dispatch(noteReviewMoment({ kind: 'bigSave' }))
    );
    const noted = localStorage.getItem('settingsData')!;
    let shows = 0;
    for (let i = 0; i < 5; i++) {
      advance(REVIEW_CARD_SETTLE_MS);
      if (cardOf(store) !== null) {
        shows++;
        act(() => {
          store.dispatch(closeReviewCard());
        });
      }
      localStorage.setItem('settingsData', noted);
    }
    expect(shows).toBe(1);
  });

  test('shows once: the card on screen covers the page', () => {
    const store = mount((s) =>
      s.dispatch(noteReviewMoment({ kind: 'bigSave' }))
    );
    advance(REVIEW_CARD_SETTLE_MS);
    const first = cardOf(store);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    advance(REVIEW_CARD_SETTLE_MS);
    expect(cardOf(store)).toBe(first);
    expect(store.getState().settingsDataState.pendingReviewAsk).toBeNull();
  });
});

describe('the ask at open', () => {
  const installedAgo = (ms: number) =>
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ extensionInstalledTime: T0 - ms })
    );

  test('notes the time ask a day after install', () => {
    installedAgo(TIME_ASK_AFTER_MS);
    const { store } = makeTestStore();
    store.dispatch(askAtOpen());
    expect(store.getState().settingsDataState.pendingReviewAsk?.moment).toEqual(
      { kind: 'time' }
    );
  });

  test('not before', () => {
    installedAgo(TIME_ASK_AFTER_MS - 1);
    const { store } = makeTestStore();
    store.dispatch(askAtOpen());
    expect(store.getState().settingsDataState.pendingReviewAsk).toBeNull();
  });

  // A popup restore noted "Your tabs are back" and closed the popup; this open
  // is where it shows. The thanks for a day's use can wait two days more.
  test('prefers a fresh pending restore over the time ask', () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        extensionInstalledTime: T0 - 2 * TIME_ASK_AFTER_MS,
        pendingReviewAsk: { moment: { kind: 'restored' }, at: T0 - MINUTE },
      })
    );
    const { store } = makeTestStore();
    store.dispatch(askAtOpen());
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}').pendingReviewAsk
    ).toEqual({ moment: { kind: 'restored' }, at: T0 - MINUTE });
  });

  test('CONTROL: a stale pending restore gives way to the time ask', () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        extensionInstalledTime: T0 - 2 * TIME_ASK_AFTER_MS,
        pendingReviewAsk: {
          moment: { kind: 'restored' },
          at: T0 - PENDING_ASK_FRESH_MS - MINUTE,
        },
      })
    );
    const { store } = makeTestStore();
    store.dispatch(askAtOpen());
    expect(store.getState().settingsDataState.pendingReviewAsk?.moment).toEqual(
      { kind: 'time' }
    );
  });
});
