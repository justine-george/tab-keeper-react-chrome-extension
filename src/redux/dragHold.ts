// KAN-279 D12. While a row is held, a change this page did not make waits:
// applying it would move the list under the pointer, and the drag engine's
// rects are measured once (drag-engine-coordinate-invariants). At the drop the
// change is applied FIRST and the drop goes on top of it (dropOnTop).
// Module state, not Redux: RowDragArea is generic and renders in tests without
// a store, and "a pointer is down" is not application data.
type Apply = () => void;
let held = false;
let queue: Apply[] = [];

export function beginDragHold(): void {
  held = true;
}
export function isDragHeld(): boolean {
  return held;
}
export function whenDragReleases(apply: Apply): void {
  if (!held) {
    apply();
    return;
  }
  queue.push(apply);
}
export interface FlushResult {
  // Something was queued, and so ran (or threw).
  ran: boolean;
  // No apply threw. False means state holds a change only partly applied or
  // not at all, and localStorage may hold one this page never took in.
  allApplied: boolean;
}

// Every apply runs, each in its own try/catch: two kinds are queued (a cloud
// merge, another page's write), and a throw in one must not drop the ones
// after it. A failure is logged and reported, not rethrown: dropOnTop reads
// allApplied and abandons the drop -- a move landing on a list that never
// took the change in would save over it -- and a status, unlike a rethrow,
// cannot escape endDragHold into the pointer handler that called it.
export function flushHeldChanges(): FlushResult {
  const pending = queue;
  queue = [];
  let allApplied = true;
  for (const apply of pending) {
    try {
      apply();
    } catch (error) {
      allApplied = false;
      console.error('A change held during a drag failed to apply: ', error);
    }
  }
  return { ran: pending.length > 0, allApplied };
}
export function endDragHold(): void {
  held = false;
  flushHeldChanges();
}
