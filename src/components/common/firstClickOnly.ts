import type React from 'react';

// A click whose count is past 1 is a double-click's second click, and it
// does nothing (KAN-280 O7c, KAN-698). A click from a key (Enter or Space on a
// button, or Icon's click()) has a count of 0, so it still acts.
export function onFirstClickOnly<E extends Element>(
  action: (event: React.MouseEvent<E>) => void
): React.MouseEventHandler<E> {
  return (event) => {
    if (event.detail > 1) return;
    action(event);
  };
}
