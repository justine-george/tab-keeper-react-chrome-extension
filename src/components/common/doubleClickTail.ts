// KAN-696. A menu item closes its menu on the first click of a double-click, so
// the second click lands on whatever slid under the pointer, and a menu item's
// handler gets no event to read the count from (onFirstClickOnly can't be used).
// Holds back the rest of that double-click until the next fresh press or key.
// Never a timer: a timer cannot say when the user's turn is over.

const TAIL_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick'] as const;

function holdBack(event: Event) {
  if (!(event instanceof MouseEvent) || event.detail <= 1) return;
  event.preventDefault();
  event.stopPropagation();
}

function release(event: Event) {
  // A fresh press (count 1) is a new turn; its own mousedown goes through.
  if (event instanceof MouseEvent && event.detail > 1) return;
  for (const type of TAIL_EVENTS) {
    document.removeEventListener(type, holdBack, true);
  }
  document.removeEventListener('mousedown', release, true);
  document.removeEventListener('keydown', release, true);
}

export function holdBackDoubleClickTail(): void {
  // Idempotent: a repeated listener is the same listener, and one press ends it.
  for (const type of TAIL_EVENTS) {
    document.addEventListener(type, holdBack, true);
  }
  document.addEventListener('mousedown', release, true);
  document.addEventListener('keydown', release, true);
}
