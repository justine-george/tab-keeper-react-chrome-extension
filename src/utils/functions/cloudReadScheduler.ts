// KAN-279 D11. The tab view is long-lived (unlike the popup, which reads the
// cloud once on open and dies), so it needs to notice other devices' changes
// on its own: once whenever it becomes visible again, and periodically while
// it stays visible. This file imports nothing from redux or the app -- it
// takes `read` and `canRead` as callbacks -- so it can be driven by a fake
// document and fake timers in a plain unit test, with no store, no thunk, and
// no real browser visibility (which Playwright and the DevTools MCP cannot
// simulate; see global-constraints.md).

/** Minimum time between two reads, so a hidden/visible flap cannot fire a
 * read on every flip. */
export const MIN_READ_GAP = 60_000;

/** How often the tab re-reads the cloud while it stays visible. */
export const TAB_READ_INTERVAL = 600_000;

/** The slice of `Document` this module needs: enough to be faked in a node
 * test without jsdom. */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Starts the tab's periodic cloud reads and returns a function that stops
 * them.
 *
 * `lastRead` is seeded to "now" rather than to "never": the caller's own
 * startup effect already read the cloud once before this runs, so the gap
 * starts counting from that read, not from zero.
 *
 * A `setInterval` runs `tryRead` every `TAB_READ_INTERVAL` while the document
 * is visible, and is cleared the moment it goes hidden -- a hidden tab never
 * reads, on a timer or otherwise. Becoming visible again always calls
 * `tryRead` once (to catch up immediately, subject to the gap) and, if still
 * visible, restarts the interval.
 *
 * `tryRead` checks `canRead()` and the gap before calling `read()`. `read()`
 * itself is called inside a try/catch, but that only guards a SYNCHRONOUS
 * throw out of `read` -- the call that dispatches the thunk, not the
 * dispatched thunk's own eventual result. `dispatch(syncStateWithFirestore())`
 * returns a promise that always resolves (to a fulfilled or rejected
 * *action*, per createAsyncThunk), and a refusal from the KAN-269 queue
 * resolves too, so neither reaches this catch and neither needs to: there is
 * no unhandled rejection to swallow, only the case where `read` itself throws
 * before returning. Either way, a bad tick must not kill the scheduler or
 * storm retries -- the next tick, or the next visibility change, tries again
 * on its own schedule.
 */
export function startCloudReads(
  doc: VisibilitySource,
  read: () => void,
  canRead: () => boolean
): () => void {
  let lastRead = Date.now();
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const tryRead = () => {
    if (!canRead()) return;
    if (Date.now() - lastRead < MIN_READ_GAP) return;
    lastRead = Date.now();
    try {
      read();
    } catch {
      // Swallowed on purpose: a `read` that throws synchronously gets no
      // retry storm. The next tick (or the next visibility change) tries
      // again on its own schedule.
    }
  };

  const startInterval = () => {
    stopInterval();
    intervalId = setInterval(tryRead, TAB_READ_INTERVAL);
  };

  const stopInterval = () => {
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  };

  const onVisibilityChange = () => {
    if (doc.visibilityState === 'visible') {
      tryRead();
      startInterval();
    } else {
      stopInterval();
    }
  };

  if (doc.visibilityState === 'visible') {
    startInterval();
  }
  doc.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    stopInterval();
    doc.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
