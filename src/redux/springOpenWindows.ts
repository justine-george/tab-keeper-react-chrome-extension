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

// A no-op when nothing is held, so it does not notify.
export function foldBackSpringOpened(): void {
  if (opened.size === 0) return;
  opened = new Set();
  notify();
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
