import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import {
  PENDING_ASK_FRESH_MS,
  REVIEW_ASK_GAP_MS,
  TIME_ASK_AFTER_MS,
  canAskForReview,
  isPendingAskFresh,
  isTimeAskDue,
  readPendingAsk,
  reviewCardCopy,
  type ReviewMoment,
} from '../../../utils/functions/reviewAsk';
import type { SettingsData } from '../../../redux/slices/settingsDataStateSlice';

// KAN-653. The review card is asked once a day after install, and otherwise
// while a payoff is still fresh. Every ask, whatever brought it, is at least
// two days after the last one.

const HOUR = 3600_000;
const MINUTE = 60_000;
const DAY = 24 * HOUR;
const T = Date.UTC(2026, 8, 10, 12, 0, 0);

const settings = (over: Partial<SettingsData> = {}) =>
  ({
    isUserRatedAndReviewed: false,
    isNeverAskAgainToRate: false,
    lastReviewRequestTime: '',
    extensionInstalledTime: T,
    isTimeAskDone: false,
    ...over,
  }) as Partial<SettingsData>;

beforeEach(() => localStorage.clear());

describe('the constants', () => {
  test('asks are two days apart, the time ask comes a day in, a carried ask lasts 30 minutes', () => {
    expect(REVIEW_ASK_GAP_MS).toBe(2 * DAY);
    expect(TIME_ASK_AFTER_MS).toBe(DAY);
    expect(PENDING_ASK_FRESH_MS).toBe(30 * MINUTE);
  });
});

describe('canAskForReview', () => {
  test('never once the user rated', () => {
    expect(canAskForReview(settings({ isUserRatedAndReviewed: true }), T)).toBe(
      false
    );
  });

  test('never once the user said never', () => {
    expect(canAskForReview(settings({ isNeverAskAgainToRate: true }), T)).toBe(
      false
    );
  });

  test('yes when nothing has been asked yet', () => {
    expect(canAskForReview(settings(), T)).toBe(true);
  });

  test('not a millisecond before the gap is over', () => {
    const last = T - REVIEW_ASK_GAP_MS + 1;
    expect(canAskForReview(settings({ lastReviewRequestTime: last }), T)).toBe(
      false
    );
  });

  test('yes the moment the gap is over', () => {
    const last = T - REVIEW_ASK_GAP_MS;
    expect(canAskForReview(settings({ lastReviewRequestTime: last }), T)).toBe(
      true
    );
  });
});

describe('isTimeAskDue', () => {
  test('not before a day after install', () => {
    expect(isTimeAskDue(settings(), T + TIME_ASK_AFTER_MS - 1)).toBe(false);
  });

  test('a day after install', () => {
    expect(isTimeAskDue(settings(), T + TIME_ASK_AFTER_MS)).toBe(true);
  });

  test('only once', () => {
    expect(isTimeAskDue(settings({ isTimeAskDone: true }), T + 5 * DAY)).toBe(
      false
    );
  });

  test('not when the install date is missing', () => {
    expect(
      isTimeAskDue(settings({ extensionInstalledTime: '' }), T + 5 * DAY)
    ).toBe(false);
  });

  test('not when the install date is not a number', () => {
    const broken = settings({
      extensionInstalledTime: 'yesterday' as unknown as number,
    });
    expect(isTimeAskDue(broken, T + 5 * DAY)).toBe(false);
  });

  test('not when no ask is allowed at all', () => {
    expect(
      isTimeAskDue(settings({ isNeverAskAgainToRate: true }), T + 5 * DAY)
    ).toBe(false);
  });

  test('day 2 after a closed onboarding ask', () => {
    const asked = settings({ lastReviewRequestTime: T + HOUR });
    expect(isTimeAskDue(asked, T + DAY)).toBe(false);
    expect(isTimeAskDue(asked, T + HOUR + REVIEW_ASK_GAP_MS)).toBe(true);
  });
});

describe('isPendingAskFresh', () => {
  const pending = { moment: { kind: 'restored' as const }, at: T };

  test('fresh for 30 minutes on another page', () => {
    expect(isPendingAskFresh(pending, T + 30 * MINUTE, false)).toBe(true);
  });

  test('stale a millisecond after', () => {
    expect(isPendingAskFresh(pending, T + 30 * MINUTE + 1, false)).toBe(false);
  });

  test('no age limit on the page that noted it', () => {
    expect(isPendingAskFresh(pending, T + 5 * HOUR, true)).toBe(true);
  });
});

describe('readPendingAsk', () => {
  test('a well-formed pending ask reads back', () => {
    const value = { moment: { kind: 'bigSave' }, at: T };
    expect(readPendingAsk(value)).toEqual(value);
  });

  test('a malformed pending ask reads as none', () => {
    for (const value of [
      undefined,
      null,
      'x',
      {},
      { moment: { kind: 'nope' }, at: 1 },
      { moment: { kind: 'time' }, at: NaN },
      { moment: 'time', at: 1 },
      { moment: { kind: 'time' } },
    ]) {
      expect(readPendingAsk(value)).toBeNull();
    }
  });
});

describe('reviewCardCopy', () => {
  const kinds: [ReviewMoment['kind'], string][] = [
    ['time', 'Thanks for using Tab Keeper'],
    ['firstSave', 'Your first session is saved'],
    ['bigSave', 'Your tabs are saved'],
    ['sessionsArrived', 'Your sessions are here'],
    ['restored', 'Your tabs are back'],
  ];

  test.each(kinds)('%s is titled "%s"', (kind, title) => {
    expect(reviewCardCopy({ kind }).titleKey).toBe(title);
  });

  test('the time ask says "If it\'s useful to you"', () => {
    expect(reviewCardCopy({ kind: 'time' }).bodyKey).toBe('ReviewCardBodyTime');
  });

  test('the first save says "If you like it so far" (KAN-659)', () => {
    expect(reviewCardCopy({ kind: 'firstSave' }).bodyKey).toBe(
      'ReviewCardBodyFirstSave'
    );
  });

  test.each(kinds.filter(([kind]) => kind !== 'time' && kind !== 'firstSave'))(
    '%s says "If Tab Keeper is useful to you"',
    (kind) => {
      expect(reviewCardCopy({ kind }).bodyKey).toBe('ReviewCardBody');
    }
  );
});
