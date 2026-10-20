// KAN-708. The one open row menu across the page: which rows it acts on and where it opened.
import { useSyncExternalStore } from 'react';

export type RowMenuKind =
  | 'session'
  | 'savedWindow'
  | 'savedGroup'
  | 'savedTab'
  | 'openWindow'
  | 'openGroup'
  | 'openTab';

export interface RowMenuTarget {
  // The useRowContextMenu instance that opened it.
  owner: string;
  kind: RowMenuKind;
  // One id today; the multi-select seam.
  ids: string[];
  at: { x: number; y: number };
  byPointer: boolean;
}

let target: RowMenuTarget | null = null;
const listeners = new Set<() => void>();

function set(next: RowMenuTarget | null): void {
  if (target === next) return;
  target = next;
  for (const listener of [...listeners]) listener();
}

export function getRowMenu(): RowMenuTarget | null {
  return target;
}

export function openRowMenu(t: RowMenuTarget): void {
  set(t);
}

export function closeRowMenu(): void {
  set(null);
}

export function subscribeRowMenu(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useRowMenuTarget(): RowMenuTarget | null {
  return useSyncExternalStore(subscribeRowMenu, getRowMenu);
}
