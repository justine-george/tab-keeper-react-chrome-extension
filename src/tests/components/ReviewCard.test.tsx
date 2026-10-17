import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const motion = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock(
  '../../components/common/tabKeeperMarkMotion',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../components/common/tabKeeperMarkMotion')
      >();
    return {
      ...actual,
      playMarkClick: (...args: unknown[]) => {
        motion.calls.push(args);
        return null;
      },
    };
  }
);

import { ReviewCard } from '../../components/reviewCard/ReviewCard';
import ClickableTabKeeperMark from '../../components/common/ClickableTabKeeperMark';
import { renderWithProviders } from '../setup/renderWithProviders';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { openReviewCard } from '../../redux/slices/globalStateSlice';
import type { ReviewMoment } from '../../utils/functions/reviewAsk';

// KAN-653. The review card: a corner card, not a dialog. It never takes
// focus, takes no pointer input while it rises, and its ✕ means Not now.

// tabs.create needs an active tab to sit beside (index 3, so the new one is 4).
const ACTIVE_TAB = {
  windows: [{ id: 1 }],
  tabs: [{ active: true, index: 3 }],
};

type Store = { dispatch: (action: unknown) => void };

const open =
  (moment: ReviewMoment, offersNever = false) =>
  (store: Store) =>
    store.dispatch(openReviewCard({ moment, offersNever }));

const renderCard = (
  moment: ReviewMoment = { kind: 'time' },
  offersNever = false
) =>
  renderWithProviders(
    <>
      <button type="button">Outside</button>
      <ReviewCard />
    </>,
    { seed: ACTIVE_TAB, seedStore: open(moment, offersNever) }
  );

const card = () => screen.getByTestId('review-card');
const notNow = () => screen.getByRole('button', { name: 'Not now' });
const rate = () => screen.getByRole('button', { name: 'Rate Tab Keeper' });

beforeEach(() => {
  localStorage.clear();
  motion.calls = [];
});
afterEach(() => {
  history.replaceState(null, '', '?');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the words', () => {
  test('the time ask', async () => {
    await renderCard({ kind: 'time' });
    expect(
      screen.getByRole('heading', { name: 'Thanks for using Tab Keeper' })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "If it's useful to you, a rating on the Chrome Web Store helps other people find it."
      )
    ).toBeTruthy();
  });

  test('a restore', async () => {
    await renderCard({ kind: 'restored' });
    expect(
      screen.getByRole('heading', { name: 'Your tabs are back' })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'If Tab Keeper is useful to you, a rating on the Chrome Web Store helps other people find it.'
      )
    ).toBeTruthy();
  });

  test('no sign-off', async () => {
    await renderCard();
    expect(card().textContent).not.toContain('Justine');
  });

  test('is named by its title', async () => {
    await renderCard({ kind: 'bigSave' });
    expect(
      screen.getByRole('complementary', { name: 'Your tabs are saved' })
    ).toBe(card());
  });
});

describe('focus', () => {
  test('stays where it was when the card opens', async () => {
    const { store } = await renderWithProviders(
      <>
        <button type="button">Outside</button>
        <ReviewCard />
      </>
    );
    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.focus();

    act(() => open({ kind: 'time' })(store));

    expect(card()).toBeTruthy();
    expect(document.activeElement).toBe(outside);
  });
});

describe('the controls', () => {
  test('✕ is Not now: it closes the card and remembers a close', async () => {
    const { store } = await renderCard();
    fireEvent.animationEnd(card());

    await userEvent.click(notNow());

    expect(screen.queryByTestId('review-card')).toBeNull();
    expect(store.getState().globalState.reviewCard).toBeNull();
    expect(store.getState().settingsDataState.isSkippedUserReviewOnce).toBe(
      true
    );
  });

  test('Rate opens the reviews page beside this tab, and stops the asks', async () => {
    const { store, chrome } = await renderCard();
    fireEvent.animationEnd(card());

    await userEvent.click(rate());

    expect(chrome.createdTabs).toHaveLength(1);
    expect(chrome.createdTabs[0].url).toMatch(/\/reviews$/);
    expect(chrome.createdTabs[0].index).toBe(4);
    expect(store.getState().settingsDataState.isUserRatedAndReviewed).toBe(
      true
    );
    expect(store.getState().globalState.reviewCard).toBeNull();
  });

  test('"Never ask again" is not offered on a first card', async () => {
    await renderCard({ kind: 'time' }, false);
    expect(
      screen.queryByRole('button', { name: 'Never ask again' })
    ).toBeNull();
  });

  test('"Never ask again" is offered after a close, and stops the asks', async () => {
    const { store } = await renderCard({ kind: 'time' }, true);
    fireEvent.animationEnd(card());

    await userEvent.click(
      screen.getByRole('button', { name: 'Never ask again' })
    );

    expect(store.getState().settingsDataState.isNeverAskAgainToRate).toBe(true);
    expect(store.getState().globalState.reviewCard).toBeNull();
  });
});

// KAN-403. An Esc the popup does not consume closes the popup, so the card
// takes Esc only from inside itself, and says so with preventDefault.
describe('Esc', () => {
  test('with focus inside the card, closes it as Not now', async () => {
    const { store } = await renderCard();
    rate().focus();

    const notCancelled = fireEvent.keyDown(rate(), { key: 'Escape' });

    expect(notCancelled).toBe(false);
    expect(store.getState().globalState.reviewCard).toBeNull();
    expect(store.getState().settingsDataState.isSkippedUserReviewOnce).toBe(
      true
    );
  });

  test('Esc outside the card does nothing to it', async () => {
    const { store } = await renderCard();
    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.focus();

    const notCancelled = fireEvent.keyDown(outside, { key: 'Escape' });

    expect(notCancelled).toBe(true);
    expect(store.getState().globalState.reviewCard).not.toBeNull();
  });

  test('an Esc that ends a composition is left alone', async () => {
    const { store } = await renderCard();
    fireEvent.keyDown(rate(), { key: 'Escape', isComposing: true });
    expect(store.getState().globalState.reviewCard).not.toBeNull();
  });
});

describe('size', () => {
  test('the full view: 440px wide, 24px in', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderCard();
    const style = getComputedStyle(card());
    expect(style.width).toBe('440px');
    expect(style.paddingTop).toBe('24px');
    expect(style.right).toBe('24px');
  });

  test('the popup: 360px wide, 16px in', async () => {
    await renderCard();
    const style = getComputedStyle(card());
    expect(style.width).toBe('360px');
    expect(style.paddingTop).toBe('16px');
    expect(style.right).toBe('16px');
  });

  // Review Focus 4. The ✕ sits over the title's corner; the title keeps out
  // from under it however long a translation runs, so it wraps instead.
  test('a long title keeps clear of the close mark', async () => {
    await renderCard();
    const title = screen.getByRole('heading');
    title.textContent = 'W'.repeat(200);
    const closeBox = notNow().parentElement!;
    expect(
      parseFloat(getComputedStyle(title).paddingRight)
    ).toBeGreaterThanOrEqual(parseFloat(getComputedStyle(closeBox).width));
  });
});

// Review Focus 2. A press already on its way to the row under the card's
// corner must land on the row, not on a card that appeared under it.
describe('the rise', () => {
  test('takes no pointer input until it ends', async () => {
    await renderCard();
    expect(getComputedStyle(card()).pointerEvents).toBe('none');

    fireEvent.animationEnd(card());

    expect(getComputedStyle(card()).pointerEvents).toBe('auto');
  });

  test('a child animation ending is not the rise ending', async () => {
    await renderCard();
    fireEvent.animationEnd(rate());
    expect(getComputedStyle(card()).pointerEvents).toBe('none');
  });

  test('reduced motion: no rise, so pointer input at once', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => new FakeMediaQueryList(query, query.includes('reduce'))
    );
    await renderCard();
    expect(getComputedStyle(card()).pointerEvents).toBe('auto');
  });
});

describe('the mark', () => {
  test('the card plays the shutter once the rise ends, silently', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderCard();
    expect(motion.calls).toHaveLength(0);

    act(() => vi.advanceTimersByTime(200));

    expect(motion.calls).toHaveLength(1);
    const [svg, shutter, beat] = motion.calls[0];
    expect(svg).toBeInstanceOf(SVGElement);
    expect((shutter as Element).getAttribute('data-mark-part')).toBe('shutter');
    expect(beat).toBeUndefined();
  });

  test('shutterOnMountAfterMs waits its delay, and plays once', () => {
    vi.useFakeTimers();
    render(<ClickableTabKeeperMark shutterOnMountAfterMs={200} />);

    act(() => vi.advanceTimersByTime(199));
    expect(motion.calls).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(motion.calls).toHaveLength(1);
    act(() => vi.advanceTimersByTime(5_000));
    expect(motion.calls).toHaveLength(1);
  });

  test('CONTROL: without it, nothing plays on mount', () => {
    vi.useFakeTimers();
    render(<ClickableTabKeeperMark />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(motion.calls).toHaveLength(0);
  });
});
