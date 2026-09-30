// KAN-349. The toasts on screen, newest last. Pure, so the rules can be
// tested without the timers that the slice runs beside them.

export const MAX_TOASTS = 3;

// The Reopen offer a toast carries (KAN-280 O8a). keepsUndoKey is whether ⌘Z
// still takes it: a saved-session change announced after it takes the key
// for good (KAN-349 Q1 C′).
export interface ToastOffer {
  id: number;
  keepsUndoKey: boolean;
}

export interface ToastItem {
  id: number;
  // An i18n KEY, not a display string -- Toast renders t(text, params).
  text: string;
  params: Record<string, string | number> | undefined;
  reopenOffer: ToastOffer | null;
}

function sameParams(a: ToastItem['params'], b: ToastItem['params']): boolean {
  if (a === undefined || b === undefined) return a === b;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && a[key] === b[key])
  );
}

// A new toast meets the rules in this order:
// - T4: an offer replaces the offer already showing IN PLACE (one offer at a
//   time), or is appended if there is none. Two closes of one tab read the
//   same, so an offer never goes through T5, which would move it.
// - T5: a plain toast replaces its twin (same key, same params), and goes to
//   the bottom.
// - Q1 C′: a toast announcing a saved-session change takes ⌘Z from the offer.
// - T2: past MAX_TOASTS, the oldest go.
export function addToast(
  list: readonly ToastItem[],
  toast: ToastItem,
  announcesSavedChange: boolean
): ToastItem[] {
  let next: ToastItem[];
  if (toast.reopenOffer !== null) {
    const at = list.findIndex((t) => t.reopenOffer !== null);
    next =
      at === -1 ? [...list, toast] : list.map((t, i) => (i === at ? toast : t));
  } else {
    next = list.filter(
      (t) =>
        t.reopenOffer !== null ||
        t.text !== toast.text ||
        !sameParams(t.params, toast.params)
    );
    if (announcesSavedChange) {
      next = next.map((t) =>
        t.reopenOffer === null
          ? t
          : { ...t, reopenOffer: { ...t.reopenOffer, keepsUndoKey: false } }
      );
    }
    next.push(toast);
  }
  return next.slice(-MAX_TOASTS);
}
