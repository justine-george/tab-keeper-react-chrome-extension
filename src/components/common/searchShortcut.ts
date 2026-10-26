import { isDragHeld } from '../../redux/dragHold';
import { isInEditableField } from '../home/rightpane/rowDrag/dropRules';

// The key that focuses the field. A key on the keyboard, the same in every
// locale, so it is not a t() string.
export const SEARCH_SHORTCUT_KEY = '/';

/**
 * Whether a keydown is the `/` that focuses a pane's search (KAN-330
 * O14b, K1). Not in a text field (it types a slash there), not with a modifier,
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

export type SearchPane = 'saved' | 'openNow';

/** KAN-800. The pane a node sits in: Open now's column (pane, rail or drawer), the saved list's panes, or none. */
export function searchPaneOf(node: Element | null): SearchPane | null {
  const pane = node?.closest('[data-pane]')?.getAttribute('data-pane');
  if (pane === 'open-now') return 'openNow';
  if (pane === 'sessions' || pane === 'detail') return 'saved';
  return null;
}
