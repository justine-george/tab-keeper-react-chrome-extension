import type { SettingsData } from '../../redux/slices/settingsDataStateSlice';

const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
export const REVIEW_ASK_BACKOFF_MS = 3 * ONE_DAY_IN_MS;

/**
 * Whether to ask the user to rate the extension on this popup open (KAN-149).
 *
 * Extracted from App.tsx and made pure, the way shouldOfferTabGroups already
 * is: the decision is the part worth testing, and inside a component closure it
 * could only be reached through a mount.
 *
 * WHAT CHANGED, AND WHY. The old gate asked once the extension had been
 * INSTALLED for a day -- which asks a stranger, since nothing about a date says
 * the product has done anything for them yet. This asks after a value moment:
 * a session restored, a substantial save, sessions arriving from another
 * device. Those are the points where the extension has just visibly paid off.
 *
 * The ask lands on the open AFTER the moment, and that is forced rather than
 * chosen -- restoring a session creates focused windows, which closes the
 * popup, so the modal and the payoff can never share a screen. Recording the
 * moment and asking on return is the only shape available. It also asks
 * someone who came back, which is its own small signal.
 *
 * The three-day backoff is kept. A value moment is a reason to ask, not a
 * licence to ask on every restore.
 *
 * `now` is a parameter rather than a Date.now() call so the caller's clock is
 * the only one in play and the tests need no fake timers.
 */
export function shouldAskForReview(
  settings: Partial<SettingsData>,
  now: number
): boolean {
  const {
    isUserRatedAndReviewed = false,
    isNeverAskAgainToRate = false,
    lastReviewRequestTime = '',
    lastValueMomentTime = '',
  } = settings;

  // Both are permanent. "Rated" is set by the modal's own CTA and by the About
  // screen's Rate button -- neither can confirm a review was actually left, so
  // both record the INTENT and stop asking. Asking again someone who already
  // went to the store is the outcome worth avoiding.
  if (isUserRatedAndReviewed || isNeverAskAgainToRate) return false;

  const valueMomentAt = asTimestamp(lastValueMomentTime);
  // The whole point: no payoff, no ask. Time alone is never a reason.
  if (valueMomentAt === null) return false;

  const lastAskedAt = asTimestamp(lastReviewRequestTime);
  if (lastAskedAt !== null) {
    if (now - lastAskedAt < REVIEW_ASK_BACKOFF_MS) return false;
    // AND, not OR. Without this the backoff expiring would itself open the
    // prompt, which is the time-based gate coming back in through the side
    // door: the moment has to be NEWER than the last ask, or it is a moment
    // we have already spent.
    if (valueMomentAt <= lastAskedAt) return false;
  }

  return true;
}

/**
 * A finite epoch milliseconds value, or null.
 *
 * Settings are read back from localStorage, where the value is whatever was
 * last written -- including by an older build, or by a hand edit. Anything that
 * is not a usable number reads as "no such moment", which fails closed: the
 * prompt stays shut rather than opening on a garbage timestamp.
 */
function asTimestamp(value: number | ''): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}
