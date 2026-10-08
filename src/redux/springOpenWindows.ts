// KAN-379. Windows this drag opened, drawn open while the stored fold is left alone.
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

// KAN-458 R1. Drawn with no rows: folded in the store and not opened by this drag.
export function isDrawnFolded(
  storedFolded: readonly string[],
  windowId: string
): boolean {
  return storedFolded.includes(windowId) && !opened.has(windowId);
}

// Whether any window folded back. A no-op when nothing is held, so it does not notify.
export function foldBackSpringOpened(): boolean {
  if (opened.size === 0) return false;
  opened = new Set();
  notify();
  return true;
}

export function subscribeSpringOpenWindows(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const snapshot = (): ReadonlySet<string> => opened;

export function useSpringOpenWindows(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeSpringOpenWindows, snapshot);
}

export function useIsSpringOpen(windowId: string): boolean {
  return useSyncExternalStore(subscribeSpringOpenWindows, () =>
    opened.has(windowId)
  );
}
