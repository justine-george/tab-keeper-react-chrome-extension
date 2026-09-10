import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import { shouldAskForReview } from '../../../utils/functions/reviewAsk';
import type { SettingsData } from '../../../redux/slices/settingsDataStateSlice';

// KAN-149. The review prompt is asked after the user has FELT the value, not
// after a clock has run down.
//
// The old gate was "installed more than a day ago", which asks a stranger: it
// fires on the first popup open after 24 hours whether the extension has done
// anything for them or not. Restoring a session is the moment the product
// actually pays off, so that is the moment worth spending.
//
// It is asked on the NEXT open rather than at the moment itself, and that is
// forced rather than chosen: restoring a session creates focused windows, which
// CLOSES the popup, so the modal and the payoff can never be on screen
// together. The trigger records; the next open asks.

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);

const settings = (over: Partial<SettingsData> = {}) =>
  ({
    isUserRatedAndReviewed: false,
    isNeverAskAgainToRate: false,
    lastReviewRequestTime: '',
    lastValueMomentTime: NOW - HOUR,
    ...over,
  }) as Partial<SettingsData>;

beforeEach(() => localStorage.clear());

describe('asking for a review after a value moment', () => {
  test('asks when a value moment has happened', () => {
    expect(shouldAskForReview(settings(), NOW)).toBe(true);
  });

  // THE POINT OF THE TICKET. Time passing is not a reason to ask; the old gate
  // would have said yes here on the strength of the install date alone.
  test('does NOT ask when nothing of value has happened yet', () => {
    expect(shouldAskForReview(settings({ lastValueMomentTime: '' }), NOW)).toBe(
      false
    );
  });

  test('does not ask once the user has rated', () => {
    expect(
      shouldAskForReview(settings({ isUserRatedAndReviewed: true }), NOW)
    ).toBe(false);
  });

  test('does not ask once the user has said never again', () => {
    expect(
      shouldAskForReview(settings({ isNeverAskAgainToRate: true }), NOW)
    ).toBe(false);
  });
});

describe('the backoff between asks', () => {
  // Kept from the old gate. A value moment is a reason to ask, not a licence to
  // ask on every restore -- without this, someone who restores sessions daily
  // would be asked daily.
  test('does not ask again within three days of the last ask', () => {
    expect(
      shouldAskForReview(
        settings({ lastReviewRequestTime: NOW - 2 * 24 * HOUR }),
        NOW
      )
    ).toBe(false);
  });

  test('asks again once three days have passed AND value was felt since', () => {
    expect(
      shouldAskForReview(
        settings({ lastReviewRequestTime: NOW - 4 * 24 * HOUR }),
        NOW
      )
    ).toBe(true);
  });

  // The two conditions are AND, not OR. Three days of silence is not itself a
  // reason -- otherwise this decays straight back into the time-based gate the
  // ticket exists to remove.
  test('stays silent after three days if no value was felt since', () => {
    expect(
      shouldAskForReview(
        settings({
          lastReviewRequestTime: NOW - 4 * 24 * HOUR,
          lastValueMomentTime: NOW - 10 * 24 * HOUR,
        }),
        NOW
      )
    ).toBe(false);
  });
});

describe('malformed stored values', () => {
  // Settings come from localStorage, which anything can write. A garbage
  // timestamp must not open the prompt, and must not throw on the popup's
  // mount path either.
  test('a non-date value moment is treated as no value moment', () => {
    expect(
      shouldAskForReview(
        settings({ lastValueMomentTime: 'yesterday' as unknown as number }),
        NOW
      )
    ).toBe(false);
  });

  test('a non-date last-request is treated as never asked', () => {
    expect(
      shouldAskForReview(
        settings({ lastReviewRequestTime: 'soon' as unknown as number }),
        NOW
      )
    ).toBe(true);
  });

  test('an empty settings object never asks and does not throw', () => {
    expect(shouldAskForReview({}, NOW)).toBe(false);
  });
});
