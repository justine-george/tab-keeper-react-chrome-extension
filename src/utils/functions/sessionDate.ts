import type { TFunction } from 'i18next';

import { calendarDaysBefore } from './calendarDay';
import { FALLBACK_LOCALE, getPrettyDate } from './local';
import { contentInstant, createdInstant } from './mergeTabData';
import type { SessionDateBasis } from '../../redux/slices/settingsDataStateSlice';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

/**
 * The one date a session row shows, and the word that says which date it is
 * (KAN-141).
 *
 * Both panes render the same session, so both call this. Two copies of the
 * choice would eventually disagree, and a row saying "Edited" beside a header
 * saying "Created" for the same session is worse than either being wrong on
 * its own.
 *
 * WHY THE WORD IS NOT OPTIONAL. The row shows one number and the list has four
 * possible orders. Without a label the number is ambiguous the moment anything
 * other than the default is chosen -- which is exactly the state that produced
 * the question this ticket came from ("is it saved date or modified date?").
 * The word is what lets the value follow the active sort without the row
 * becoming a guess.
 *
 * `basis` comes from device-local settings, never from the container: see
 * SettingsData.sessionDateBasis for why it is not synced.
 */
export function sessionDateLabel(
  group: tabContainerData,
  basis: SessionDateBasis,
  locale: string,
  t: TFunction,
  today: Date
): string {
  const { showCreated, instant } = datedInstant(group, basis);
  const date = sessionWhen(instant, locale, today);

  // One phrase with the date inside it, not a word glued in front (KAN-286):
  // ja and hi put the date first.
  return showCreated ? t('CreatedOn', { date }) : t('EditedOn', { date });
}

/**
 * The full timestamp behind the label, for its hover (KAN-347): the seconds
 * and the year the label leaves out, of the same instant.
 */
export function sessionDateTitle(
  group: tabContainerData,
  basis: SessionDateBasis,
  locale: string
): string {
  return getPrettyDate(datedInstant(group, basis).instant, locale);
}

/**
 * The label with the full timestamp, for an exported file (KAN-347). A file
 * is read later, so a trimmed or relative date in it would go stale; the
 * word and the instant are the row's.
 */
export function sessionDateStamp(
  group: tabContainerData,
  basis: SessionDateBasis,
  locale: string,
  t: TFunction
): string {
  const { showCreated, instant } = datedInstant(group, basis);
  const date = getPrettyDate(instant, locale);
  return showCreated ? t('CreatedOn', { date }) : t('EditedOn', { date });
}

// Which instant a session shows, and whether the word is "Created".
function datedInstant(
  group: tabContainerData,
  basis: SessionDateBasis
): { showCreated: boolean; instant: number } {
  // A session with no contentModified has never been edited, so "Edited" would
  // be a false statement about it whatever the basis says. contentInstant
  // already falls back to the creation instant for these; this makes the WORD
  // fall back with it rather than letting the two disagree.
  const neverEdited = group.contentModified === undefined;
  const showCreated = basis === 'created' || neverEdited;
  return {
    showCreated,
    instant: showCreated ? createdInstant(group) : contentInstant(group),
  };
}

/**
 * The date part of a session's label (KAN-347): "today" or "yesterday" and
 * the time; otherwise the date and time without seconds, and without the
 * year while it is this year. A date from another year keeps its year and
 * drops the time.
 *
 * `today` is passed in, never read here, so the caller that redraws when the
 * day changes decides what "this year" is, and tests can pin it.
 */
export function sessionWhen(
  instant: number,
  locale: string,
  today: Date
): string {
  const at = new Date(instant);
  // Intl throws a RangeError on an Invalid Date (as in getPrettyDate).
  if (Number.isNaN(at.getTime())) return '';

  const days = calendarDaysBefore(instant, today);
  // Today and yesterday are words (Intl knows them in every locale we ship).
  // A time up to a day later than today comes from another device whose
  // clock runs a little fast; "tomorrow" would be false (and in hi, कल also
  // means yesterday), so it reads as today. Further ahead is a corrupt time
  // or a clock badly wrong, and is dated like any other (KAN-348).
  if (days >= -1 && days <= 1) {
    const word = relativeDay(locale, days <= 0 ? 0 : 1);
    const time = formatIn(locale, { hour: 'numeric', minute: '2-digit' }, at);
    // A comma reads as a list break in CJK; those join with a space.
    return `${word}${/^(ja|zh|ko)\b/i.test(locale) ? ' ' : ', '}${time}`;
  }

  return formatIn(
    locale,
    at.getFullYear() === today.getFullYear()
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { dateStyle: 'medium' },
    at
  );
}

// `locale` comes from localStorage, so a malformed tag is possible; Intl
// throws a RangeError for one (getPrettyDate does the same).
function formatIn(
  locale: string,
  options: Intl.DateTimeFormatOptions,
  at: Date
): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(at);
  } catch {
    return new Intl.DateTimeFormat(FALLBACK_LOCALE, options).format(at);
  }
}

// "today" (0) or "yesterday" (1), from Intl rather than a translation key.
function relativeDay(locale: string, daysAgo: 0 | 1): string {
  const format = (l: string) =>
    new Intl.RelativeTimeFormat(l, { numeric: 'auto' }).format(-daysAgo, 'day');
  try {
    return format(locale);
  } catch {
    return format(FALLBACK_LOCALE);
  }
}
