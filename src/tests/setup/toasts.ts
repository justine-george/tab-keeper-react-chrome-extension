import type { RootState } from '../../redux/store';
import type { ToastItem } from '../../redux/toastStack';

// KAN-349. Reads of the toast stack for tests that used to read the single
// toast slot. Newest last, as the list is.

export const toastTexts = (state: RootState): string[] =>
  state.globalState.toasts.map((t) => t.text);

export const newestToast = (state: RootState): ToastItem | undefined =>
  state.globalState.toasts[state.globalState.toasts.length - 1];

export const isToastShowing = (state: RootState): boolean =>
  state.globalState.toasts.length > 0;

// The id of the Reopen offer a toast on screen carries, or null.
export const shownOfferId = (state: RootState): number | null => {
  for (const toast of state.globalState.toasts) {
    if (toast.reopenOffer !== null) return toast.reopenOffer.id;
  }
  return null;
};
