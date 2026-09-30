// KAN-349 T3. One timer per toast, by toast id. Kept here, outside Redux,
// because a timeout handle is not state: the slice holds what is on screen,
// this holds when each of it leaves. Imports nothing from Redux, so the slice
// and the toast middleware can both use it without an import cycle.

interface ToastTimer {
  // What the toast's time running out does: take it off the list.
  leave: () => void;
  // Null while held; `timeLeft` is then what it resumes with.
  timeout: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  timeLeft: number;
}

const timers = new Map<number, ToastTimer>();
// The pointer or focus is on the stack, so every timer is stopped.
let held = false;

function run(timer: ToastTimer): void {
  timer.startedAt = Date.now();
  timer.timeout = setTimeout(() => {
    timer.timeout = null;
    timer.leave();
  }, timer.timeLeft);
}

export function startToastTimer(
  id: number,
  duration: number,
  leave: () => void
): void {
  // A hold is the pointer or focus on toasts that are showing. With none
  // showing there is nothing it can be on, so a toast that arrives on an
  // empty stack starts unheld; Toast holds it again if the pointer is still
  // there.
  if (timers.size === 0) held = false;
  const timer: ToastTimer = {
    leave,
    timeout: null,
    startedAt: 0,
    timeLeft: duration,
  };
  timers.set(id, timer);
  if (!held) run(timer);
}

// The pointer over any toast, or focus in one, stops every timer (KAN-349 T3,
// from KAN-280 O8a). Synchronous, so the hold is in place before the event
// that asked for it has finished.
export function holdToasts(): void {
  if (held) return;
  held = true;
  const now = Date.now();
  for (const timer of timers.values()) {
    if (timer.timeout === null) continue;
    clearTimeout(timer.timeout);
    timer.timeout = null;
    timer.timeLeft = Math.max(0, timer.timeLeft - (now - timer.startedAt));
  }
}

// Each timer resumes with the time it had left.
export function releaseToasts(): void {
  if (!held) return;
  held = false;
  for (const timer of timers.values()) {
    if (timer.timeout === null) run(timer);
  }
}

// Timers for toasts no longer on screen stop and go.
export function pruneToastTimers(onScreen: ReadonlySet<number>): void {
  for (const [id, timer] of timers) {
    if (onScreen.has(id)) continue;
    if (timer.timeout !== null) clearTimeout(timer.timeout);
    timers.delete(id);
  }
}
