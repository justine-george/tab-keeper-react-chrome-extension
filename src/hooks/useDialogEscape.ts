import { useEffect } from 'react';

// KAN-426. Chrome closes the popup on an unprevented Esc, and preventing it also stops the dialog's cancel.
function claimDialogEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const dialog = document.querySelector('dialog:modal');
  if (!(dialog instanceof HTMLDialogElement)) return;
  event.preventDefault();
  // The browser's own close request: cancel, then close unless cancel was prevented.
  if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) {
    dialog.close();
  }
}

/** Esc on an open modal dialog does that dialog's cancel and never reaches the browser. */
export function useDialogEscape(): void {
  useEffect(() => {
    document.addEventListener('keydown', claimDialogEscape);
    return () => document.removeEventListener('keydown', claimDialogEscape);
  }, []);
}
