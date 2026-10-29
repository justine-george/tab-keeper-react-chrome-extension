import type { SettingsData } from '../../redux/slices/settingsDataStateSlice';
import { isValidDate } from './local';

const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * The shortest time between two asks, whatever brought them (KAN-653). A
 * payoff is a reason to ask, not a licence to ask on every restore.
 */
export const REVIEW_ASK_GAP_MS = 2 * ONE_DAY_IN_MS;

/**
 * The one ask that needs no payoff: a day after install. 1.8.0 dropped it
 * (KAN-149) and store reviews fell with it, so it is back, once.
 */
export const TIME_ASK_AFTER_MS = ONE_DAY_IN_MS;

/**
 * How long an ask noted on one page can wait for another page to show it. A
 * popup restore closes the popup, so its ask can only appear on the next
 * open, and only while the restore is still the thing on the person's mind.
 */
export const PENDING_ASK_FRESH_MS = 30 * 60 * 1000;

/** What the card is thanking the person for. It picks the card's words. */
export type ReviewMoment =
  | { kind: 'time' }
  | { kind: 'firstSave' }
  | { kind: 'bigSave' }
  | { kind: 'sessionsArrived' }
  | { kind: 'restored' }
  // KAN-861. Got it on What's new, when nothing in it changed a default.
  | { kind: 'updated' };

/** An ask that is due but not yet on screen. `at` is when it was noted. */
export interface PendingReviewAsk {
  moment: ReviewMoment;
  at: number;
}

const MOMENT_KINDS: ReadonlySet<string> = new Set([
  'time',
  'firstSave',
  'bigSave',
  'sessionsArrived',
  'restored',
  'updated',
] satisfies ReviewMoment['kind'][]);

function isMomentKind(kind: unknown): kind is ReviewMoment['kind'] {
  return typeof kind === 'string' && MOMENT_KINDS.has(kind);
}

/**
 * Whether any ask may be made now. `now` is a parameter so the caller's clock
 * is the only one in play and the tests need no fake timers.
 */
export function canAskForReview(
  settings: Partial<SettingsData>,
  now: number
): boolean {
  const {
    isUserRatedAndReviewed = false,
    isNeverAskAgainToRate = false,
    lastReviewRequestTime = '',
  } = settings;

  // Both are permanent. "Rated" is set by the card's Rate and by About's Rate
  // button -- neither can confirm a review was left, so both record the
  // INTENT and stop asking.
  if (isUserRatedAndReviewed || isNeverAskAgainToRate) return false;

  const lastAskedAt = asTimestamp(lastReviewRequestTime);
  return lastAskedAt === null || now - lastAskedAt >= REVIEW_ASK_GAP_MS;
}

/**
 * Whether the day-after-install ask is due. It is asked once; an earlier ask
 * (the onboarding one, say) only delays it, through the gap.
 */
export function isTimeAskDue(
  settings: Partial<SettingsData>,
  now: number
): boolean {
  const { extensionInstalledTime = '', isTimeAskDone = false } = settings;
  if (isTimeAskDone) return false;
  if (!isValidDate(extensionInstalledTime)) return false;
  const installedAt = new Date(extensionInstalledTime).getTime();
  if (now - installedAt < TIME_ASK_AFTER_MS) return false;
  return canAskForReview(settings, now);
}

/**
 * The stored pending ask, or null. Settings come back from localStorage as
 * whatever was last written -- by an older build or by hand -- so anything
 * that is not exactly a known moment and a finite time reads as no ask.
 */
export function readPendingAsk(value: unknown): PendingReviewAsk | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('moment' in value) || !('at' in value)) return null;
  const { moment, at } = value;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (typeof moment !== 'object' || moment === null) return null;
  if (!('kind' in moment) || !isMomentKind(moment.kind)) return null;
  return { moment: { kind: moment.kind }, at };
}

/**
 * Whether a pending ask may still be shown. The page that noted it shows it
 * whenever it is next clear, however long that takes (a full-view restore
 * asks when the page gets focus back); any other page only within
 * PENDING_ASK_FRESH_MS.
 */
export function isPendingAskFresh(
  pending: PendingReviewAsk,
  now: number,
  notedHere: boolean
): boolean {
  return notedHere || now - pending.at <= PENDING_ASK_FRESH_MS;
}

/**
 * The card's title and body keys. No title carries a session's name: the
 * person's own words never go in the headline.
 */
export function reviewCardCopy(moment: ReviewMoment): {
  titleKey: string;
  bodyKey: string;
} {
  switch (moment.kind) {
    case 'time':
    case 'updated':
      return {
        titleKey: 'Thanks for using Tab Keeper',
        bodyKey: 'ReviewCardBodyTime',
      };
    case 'firstSave':
      return {
        titleKey: 'Your first session is saved',
        // KAN-659. A minute in, liking it, not whether it's useful.
        bodyKey: 'ReviewCardBodyFirstSave',
      };
    case 'bigSave':
      return { titleKey: 'Your tabs are saved', bodyKey: 'ReviewCardBody' };
    case 'sessionsArrived':
      return { titleKey: 'Your sessions are here', bodyKey: 'ReviewCardBody' };
    case 'restored':
      return { titleKey: 'Your tabs are back', bodyKey: 'ReviewCardBody' };
  }
}

/**
 * A finite epoch milliseconds value, or null. Anything else reads as "never
 * asked", which is what an older build's or a hand edit's garbage deserves.
 */
function asTimestamp(value: number | ''): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}
