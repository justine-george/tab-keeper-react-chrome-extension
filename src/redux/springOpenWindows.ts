// KAN-379. The saved windows THIS drag gesture opened, drawn open while the
// stored fold (globalState.collapsedWindows) stays untouched.
//
// Module state, like dragCard.ts: the drag engine is generic and renders
// without a store, and "opened for the length of a drag" is not data. Holds
// saved window ids only, never NEW_LAST_WINDOW.
import { useSyncExternalStore } from 'react';

let opened: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

// A no-op for a window already held, so a reader is not re-rendered for nothing.
export function springOpenWindow(windowId: string): void {
  if (opened.has(windowId)) return;
  opened = new Set([...opened, windowId]);
  notify();
}

export function isSpringOpen(windowId: string): boolean {
  return opened.has(windowId);
}

// A no-op when nothing is held, so it does not notify.
export function foldBackSpringOpened(): void {
  if (opened.size === 0) return;
  opened = new Set();
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const snapshot = (): ReadonlySet<string> => opened;

export function useSpringOpenWindows(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, snapshot);
}

export function useIsSpringOpen(windowId: string): boolean {
  return useSyncExternalStore(subscribe, () => opened.has(windowId));
}
