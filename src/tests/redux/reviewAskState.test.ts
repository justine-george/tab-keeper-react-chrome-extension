import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import reducer, {
  markTimeAskDone,
  setPendingReviewAsk,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import globalReducer, {
  closeReviewCard,
  openReviewCard,
} from '../../redux/slices/globalStateSlice';

// KAN-653. One pending ask, the time ask's flag, and the card on screen. The
// first two are settings, so they reach localStorage: the popup and the full
// view are separate pages and only localStorage is shared between them.

const stored = (): Partial<SettingsData> =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

beforeEach(() => localStorage.clear());

describe('the pending ask', () => {
  test('setting one persists it', () => {
    const pending = { moment: { kind: 'restored' as const }, at: 1234 };
    const state = reducer(undefined, setPendingReviewAsk(pending));

    expect(state.pendingReviewAsk).toEqual(pending);
    expect(stored().pendingReviewAsk).toEqual(pending);
  });

  test('clearing it persists null', () => {
    let state = reducer(
      undefined,
      setPendingReviewAsk({ moment: { kind: 'time' }, at: 1 })
    );
    state = reducer(state, setPendingReviewAsk(null));

    expect(state.pendingReviewAsk).toBeNull();
    expect(stored().pendingReviewAsk).toBeNull();
  });
});

describe('the time ask flag', () => {
  test('marking it done persists it', () => {
    const state = reducer(undefined, markTimeAskDone());

    expect(state.isTimeAskDone).toBe(true);
    expect(stored().isTimeAskDone).toBe(true);
  });
});

describe('the card', () => {
  test('opens with its moment and whether it offers "never"', () => {
    const card = { moment: { kind: 'bigSave' as const }, offersNever: true };
    const state = globalReducer(undefined, openReviewCard(card));

    expect(state.reviewCard).toEqual(card);
  });

  test('closes', () => {
    let state = globalReducer(
      undefined,
      openReviewCard({ moment: { kind: 'time' }, offersNever: false })
    );
    state = globalReducer(state, closeReviewCard());

    expect(state.reviewCard).toBeNull();
  });
});

describe('settings from an older build', () => {
  const loadWith = async (settings: object) => {
    localStorage.setItem('settingsData', JSON.stringify(settings));
    vi.resetModules();
    const slice = await import('../../redux/slices/settingsDataStateSlice');
    return slice.initialState;
  };

  test.each([
    ['missing', {}],
    ['null', { pendingReviewAsk: null }],
    ['a string', { pendingReviewAsk: 'soon' }],
    [
      'an unknown moment',
      { pendingReviewAsk: { moment: { kind: 'nope' }, at: 1 } },
    ],
  ])('a pending ask that is %s loads as none', async (_, settings) => {
    expect((await loadWith(settings)).pendingReviewAsk).toBeNull();
  });

  test('a well-formed pending ask loads', async () => {
    const pending = { moment: { kind: 'restored' }, at: 5 };
    expect(
      (await loadWith({ pendingReviewAsk: pending })).pendingReviewAsk
    ).toEqual(pending);
  });

  test('a time ask flag that is not true loads as false', async () => {
    expect((await loadWith({ isTimeAskDone: 'yes' })).isTimeAskDone).toBe(
      false
    );
  });
});
