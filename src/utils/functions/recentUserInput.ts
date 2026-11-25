// KAN-999. When this page last had a press or a key from the user. The
// browser's own user activation cannot say: a page opened from a click starts
// with it already active. Read by motion that only a user's action may start.
let lastInput = -Infinity;

function note(e: Event): void {
  if (e.isTrusted) lastInput = performance.now();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', note, {
    capture: true,
    passive: true,
  });
  window.addEventListener('keydown', note, { capture: true, passive: true });
}

/** Whether the user pressed or typed in this page within the last `ms`. */
export function hadUserInputWithin(ms: number): boolean {
  return performance.now() - lastInput <= ms;
}
