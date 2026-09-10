import { getPrettyDate } from './local';
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
  t: (key: string) => string
): string {
  // A session with no contentModified has never been edited, so "Edited" would
  // be a false statement about it whatever the basis says. contentInstant
  // already falls back to the creation instant for these; this makes the WORD
  // fall back with it rather than letting the two disagree.
  const neverEdited = group.contentModified === undefined;
  const showCreated = basis === 'created' || neverEdited;

  const instant = showCreated ? createdInstant(group) : contentInstant(group);
  const word = showCreated ? t('Created') : t('Edited');

  return `${word} ${getPrettyDate(instant, locale)}`;
}
