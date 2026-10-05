import { useEffect } from 'react';

import { isDragHeld } from '../redux/dragHold';

// KAN-426. Chrome closes the popup on an unprevented Esc, and preventing it also stops the dialog's cancel.
function claimDialogEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  // A drag owns its Esc, and an Esc that ends IME composition is not a cancel.
  if (isDragHeld() || event.isComposing || event.keyCode === 229) return;
  const holder =
    event.target instanceof Element ? event.target.closest('dialog') : null;
  const dialog = holder?.matches(':modal')
    ? holder
    : document.querySelector('dialog:modal');
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
