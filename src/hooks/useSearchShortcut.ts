import { useEffect, useRef } from 'react';

import {
  isSearchShortcut,
  searchPaneFor,
  type SearchPane,
} from '../components/common/searchShortcut';

type Handler = { current: (() => void) | null };

// One stack per pane: the latest registration with a handler wins.
const registry: Record<SearchPane, Handler[]> = { saved: [], openNow: [] };

function handlerFor(pane: SearchPane): (() => void) | null {
  const stack = registry[pane];
  for (let i = stack.length - 1; i >= 0; i--) {
    const handler = stack[i].current;
    if (handler !== null) return handler;
  }
  return null;
}

function onKeyDown(event: KeyboardEvent) {
  if (!isSearchShortcut(event)) return;
  const handler = handlerFor(searchPaneFor(document.activeElement));
  // No handler: the key is not ours, so it types or acts as usual.
  if (handler === null) return;
  // Before focus moves: otherwise the / is typed into the field.
  event.preventDefault();
  handler();
}

function registrations(): number {
  return registry.saved.length + registry.openNow.length;
}

/**
 * Calls `onShortcut` on `/` while focus is in `pane` and it is not null.
 * The caller's closure is read through a ref, so a new one each render
 * doesn't re-register.
 */
export function useSearchShortcut(
  pane: SearchPane,
  onShortcut: (() => void) | null
): void {
  const entry = useRef<Handler>({ current: onShortcut });
  useEffect(() => {
    entry.current.current = onShortcut;
  });
  useEffect(() => {
    const mine = entry.current;
    if (registrations() === 0) window.addEventListener('keydown', onKeyDown);
    registry[pane].push(mine);
    return () => {
      registry[pane] = registry[pane].filter((h) => h !== mine);
      if (registrations() === 0) {
        window.removeEventListener('keydown', onKeyDown);
      }
    };
  }, [pane]);
}
