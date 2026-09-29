import { isDragHeld } from '../../../redux/dragHold';
import { isInEditableField } from '../rightpane/rowDrag/dropRules';

// The key that focuses the field. A key on the keyboard, the same in every
// locale, so it is not a t() string.
export const SEARCH_SHORTCUT_KEY = '/';

/**
 * Whether a keydown is the `/` that focuses Open now's search (KAN-330
 * O14b). Not in a text field (it types a slash there), not with a modifier,
 * not on a repeat, not while a modal <dialog> is open (the page behind it is
 * inert), and not while a row is held: a search starting mid-drag would
 * change the list under the pointer (D12).
 */
export function isSearchShortcut(event: KeyboardEvent): boolean {
  return (
    event.key === SEARCH_SHORTCUT_KEY &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !isInEditableField(event.target) &&
    document.querySelector('dialog[open]') === null &&
    !isDragHeld()
  );
}
