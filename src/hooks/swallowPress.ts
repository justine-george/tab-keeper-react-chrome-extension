// KAN-778. A press that only closed a menu: nothing under it hears any of it --
// no drag, no focus move, no text selection, no click. Held back until the next
// press or key, never a timer: a release outside the page sends no click at all.

const PRESS_TAIL = ['mousedown', 'pointerup', 'mouseup', 'click'] as const;

function holdBack(event: Event) {
  // A click with no press behind it (a key, or code) is not this press's.
  if (
    event.type === 'click' &&
    event instanceof MouseEvent &&
    event.detail === 0
  )
    return;
  event.preventDefault();
  event.stopPropagation();
}

function release() {
  for (const type of PRESS_TAIL) {
    window.removeEventListener(type, holdBack, true);
  }
  window.removeEventListener('pointerdown', release, true);
  window.removeEventListener('keydown', release, true);
}

/** Call from a window CAPTURE `pointerdown` listener, so the press reaches nothing else. */
export function swallowPress(press: PointerEvent): void {
  holdBack(press);
  for (const type of PRESS_TAIL) {
    window.addEventListener(type, holdBack, true);
  }
  // Added during this press's own dispatch at window, so it does not hear this press.
  window.addEventListener('pointerdown', release, true);
  window.addEventListener('keydown', release, true);
}
