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
export function flushHeldChanges(): boolean {
  const pending = queue;
  queue = [];
  pending.forEach((apply) => apply());
  return pending.length > 0;
}
export function endDragHold(): void {
  held = false;
  flushHeldChanges();
}
