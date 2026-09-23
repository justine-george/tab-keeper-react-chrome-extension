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
// Each apply runs in its own try/catch: two kinds are queued (a cloud merge,
// another page's write), and a throw in one must not drop the ones after it.
// Reported, not rethrown, so dropOnTop still applies the move on top of
// whatever did apply -- a rethrow would lose the drop as well.
export function flushHeldChanges(): boolean {
  const pending = queue;
  queue = [];
  for (const apply of pending) {
    try {
      apply();
    } catch (error) {
      console.error('A change held during a drag failed to apply: ', error);
    }
  }
  return pending.length > 0;
}
export function endDragHold(): void {
  held = false;
  flushHeldChanges();
}
