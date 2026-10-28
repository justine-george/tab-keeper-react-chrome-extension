// KAN-852. A copy let go on Currently open that opens as a new window is
// scrolled into view once listed. The worker opens it and sends no answer, so
// its id is not known here: the Open now pane follows the first window it
// lists that it did not list when this was asked. Outside Redux, like
// reopenFocus: a live window id is never stored.
export const NEW_WINDOW_FOLLOW_MS = 3000;

// Which ask is waiting, so the pane can tell a new ask from the one it
// already noted the windows for; null when none is.
let pending: number | null = null;
let asks = 0;
let expiry: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

// Replaces any earlier one. A window not listed within NEW_WINDOW_FOLLOW_MS
// is not followed.
export function expectNewWindow(): void {
  if (expiry !== null) clearTimeout(expiry);
  asks += 1;
  pending = asks;
  expiry = setTimeout(clearNewWindowFollow, NEW_WINDOW_FOLLOW_MS);
  notify();
}

export function pendingNewWindow(): number | null {
  return pending;
}

// Followed, or its time ran out: nothing is waiting any more.
export function clearNewWindowFollow(): void {
  if (expiry !== null) {
    clearTimeout(expiry);
    expiry = null;
  }
  if (pending === null) return;
  pending = null;
  notify();
}

export function subscribeNewWindowFollow(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
