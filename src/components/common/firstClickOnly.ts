import type React from 'react';

// A click whose count is past 1 is a double-click's second click, and it
// does nothing (KAN-280 O7c, KAN-698). A key press arrives through click()
// with a count of 0, so it still acts.
export function onFirstClickOnly(action: () => void): React.MouseEventHandler {
  return (event) => {
    if (event.detail > 1) return;
    action();
  };
}
