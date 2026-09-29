import type { OpenTab, OpenWindow } from './openNow';

/**
 * The term a search runs on, or null when the field holds no search
 * (KAN-330 O14a). Trimmed and lower-cased, so "Kyoto " and "kyoto" are one
 * search and text that is only spaces is none. Drag is off exactly when this
 * is not null (O14c), so the filter and the drag rule read this one function.
 */
export function searchTermOf(fieldText: string): string | null {
  const term = fieldText.trim().toLowerCase();
  return term === '' ? null : term;
}

/** A live tab matches when its title or its address contains the term. */
export function openTabMatches(tab: OpenTab, term: string): boolean {
  return (
    tab.title.toLowerCase().includes(term) ||
    tab.url.toLowerCase().includes(term)
  );
}

/**
 * What a search draws: window id -> the ids of its matching tabs. A window
 * with no match has no entry.
 *
 * Ids, never narrowed windows. The pane still hands every handler the whole
 * OpenWindow (O14a), so Save all saves every window, hidden ones included,
 * and a window's Save and Close, which are not offered while a search is held
 * (O14e), act on the whole window once the search is cleared. A window
 * narrowed to its matches would save or reopen without the tabs the search
 * hid.
 */
export type OpenNowMatches = ReadonlyMap<number, ReadonlySet<number>>;

export function matchOpenWindows(
  windows: readonly OpenWindow[],
  term: string
): OpenNowMatches {
  const matches = new Map<number, ReadonlySet<number>>();
  for (const window of windows) {
    const ids = new Set(
      window.tabs
        .filter((tab) => openTabMatches(tab, term))
        .map((tab) => tab.id)
    );
    if (ids.size > 0) matches.set(window.id, ids);
  }
  return matches;
}

export function countMatchedTabs(matches: OpenNowMatches): number {
  let count = 0;
  for (const ids of matches.values()) count += ids.size;
  return count;
}
