// KAN-917. The name typed into the header's rename field, not yet saved, so the
// session's row can show it. Module state, not Redux: a keystroke is not a
// save, and the store saves, syncs and records undo only on commit.
import { useSyncExternalStore } from 'react';

import { isBlankTitle, normalizeTitle } from '../../utils/functions/local';

interface Draft {
  tabGroupId: string;
  title: string;
}

let draft: Draft | null = null;
const listeners = new Set<() => void>();

function set(next: Draft | null): void {
  if (draft?.tabGroupId === next?.tabGroupId && draft?.title === next?.title)
    return;
  draft = next;
  for (const listener of [...listeners]) listener();
}

export function setSessionRenameDraft(tabGroupId: string, title: string): void {
  set({ tabGroupId, title });
}

export function clearSessionRenameDraft(): void {
  set(null);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// What saving would leave: the draft trimmed, or the saved name for a blank
// draft, which a save refuses (KAN-84).
export function useShownSessionTitle(
  tabGroupId: string,
  savedTitle: string
): string {
  return useSyncExternalStore(subscribe, () =>
    draft?.tabGroupId === tabGroupId && !isBlankTitle(draft.title)
      ? normalizeTitle(draft.title)
      : savedTitle
  );
}
