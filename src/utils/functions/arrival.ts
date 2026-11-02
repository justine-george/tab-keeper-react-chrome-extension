// KAN-892. The tabs a saved window dropped on an open window added there, as
// the worker answered: Open now listens to show them. Outside Redux, like
// newWindowFollow: a live tab id is never stored.
export interface Arrival {
  windowId: number;
  tabIds: number[];
}

const listeners = new Set<(a: Arrival) => void>();

export function announceArrival(windowId: number, tabIds: number[]): void {
  for (const listener of [...listeners]) listener({ windowId, tabIds });
}

export function subscribeArrival(fn: (a: Arrival) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
