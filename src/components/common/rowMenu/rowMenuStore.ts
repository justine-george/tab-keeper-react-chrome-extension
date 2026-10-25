// KAN-708. The one open row menu across the page: which rows it acts on and where it opened.
import { useSyncExternalStore } from 'react';

export type RowMenuKind =
  | 'session'
  | 'savedWindow'
  | 'savedGroup'
  | 'savedTab'
  | 'openWindow'
  | 'openGroup'
  | 'openTab'
  | 'openNowHeader';

export interface RowMenuTarget {
  // KAN-708. The useRowContextMenu instance that opened it.
  owner: string;
  kind: RowMenuKind;
  // KAN-708. One id today; the multi-select seam.
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

// KAN-708. The open menu if this owner opened it, so an open or close elsewhere re-renders nothing here.
export function useOwnRowMenu(owner: string): RowMenuTarget | null {
  return useSyncExternalStore(subscribeRowMenu, () =>
    target?.owner === owner ? target : null
  );
}
