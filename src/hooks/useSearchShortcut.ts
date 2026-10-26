import { useEffect, useRef, useSyncExternalStore } from 'react';

import {
  isSearchShortcut,
  searchPaneOf,
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

// KAN-800. The pane last pressed, empty space included, or reached by a key; none until then.
let chosen: SearchPane | null = null;
// Whether the latest input was a key: focus the page moves after a press (the drawer handing it to its rail) chooses nothing.
let lastInputWasKey = false;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((subscriber) => subscriber());

function choose(node: EventTarget | null) {
  const pane = searchPaneOf(node instanceof Element ? node : null);
  if (pane === null || pane === chosen) return;
  chosen = pane;
  notify();
}

/** Where / goes now: the chosen pane while it has a handler, else the saved list's. */
function searchTarget(): SearchPane {
  return chosen === 'openNow' && handlerFor('openNow') !== null
    ? 'openNow'
    : 'saved';
}

function onKeyDown(event: KeyboardEvent) {
  lastInputWasKey = true;
  if (!isSearchShortcut(event)) return;
  const handler = handlerFor(searchTarget());
  // No handler: the key is not ours, so it types or acts as usual.
  if (handler === null) return;
  // Before focus moves: otherwise the / is typed into the field.
  event.preventDefault();
  handler();
}

function onPointerDown(event: PointerEvent) {
  lastInputWasKey = false;
  choose(event.target);
}

function onFocusIn(event: FocusEvent) {
  if (lastInputWasKey) choose(event.target);
}

function registrations(): number {
  return registry.saved.length + registry.openNow.length;
}

function listen() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('focusin', onFocusIn, true);
}

function stopListening() {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('focusin', onFocusIn, true);
  // Nothing left to search: the next page starts unchosen.
  chosen = null;
  lastInputWasKey = false;
}

/**
 * Calls `onShortcut` on `/` while `pane` is where / goes and it is not null.
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
    if (registrations() === 0) listen();
    registry[pane].push(mine);
    notify();
    return () => {
      registry[pane] = registry[pane].filter((h) => h !== mine);
      if (registrations() === 0) stopListening();
      notify();
    };
  }, [pane]);
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

/** KAN-800. Where / goes now, for the field (or the rail) that shows its chip. */
export function useSearchTarget(): SearchPane {
  return useSyncExternalStore(subscribe, searchTarget);
}
