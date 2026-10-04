import type { KeyboardEvent } from 'react';

// Enter commits and Esc cancels, in every rename field alike.
export function renameKeyDown(
  e: KeyboardEvent<HTMLInputElement>,
  commit: () => void,
  cancel: () => void
) {
  // An IME's Enter and Esc confirm or cancel its word, not the rename.
  if (e.nativeEvent.isComposing) {
    e.stopPropagation();
    return;
  }
  if (e.key === 'Enter') {
    commit();
  } else if (e.key === 'Escape') {
    // Chrome closes the popup on any Esc nothing prevented.
    e.preventDefault();
    e.stopPropagation();
    cancel();
  }
}
