import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { MAX_TOASTS, type ToastItem } from '../../redux/toastStack';

// Newest drawn over the older ones it hides; leaving toasts keep theirs.
const MAX_DEPTH = MAX_TOASTS + 1;

// KAN-349 motion, as settled on the bench (T1–T5 A): a new toast rises 12px
// into place and fades in, and the ones above move up with it; a leaving one
// fades out where it is, and the ones above settle down. Reduced motion:
// fades only.
export const TOAST_GAP_PX = 8;
export const TOAST_RISE_PX = 12;
export const TOAST_MOVE = '220ms cubic-bezier(0.2, 0, 0, 1)';
export const TOAST_LEAVE_MS = 160;
export const TOAST_FADE_REDUCED = '120ms linear';
// KAN-488. Collapsed, each older toast peeks this far above the one in front of it, this much narrower.
export const TOAST_PEEK_PX = 8;
export const TOAST_PEEK_SCALE = 0.05;

// A toast drawn on screen: one in the store, or one that has just left it
// and is fading out for TOAST_LEAVE_MS.
export interface ShownToast {
  toast: ToastItem;
  leaving: boolean;
}

// The store's list, with the toasts that have left it kept where they were
// while they fade. A new toast goes after the one it follows in the store's
// list, so an offer replacing the old offer (T4) arrives in its place.
export function mergeShown(
  shown: readonly ShownToast[],
  toasts: readonly ToastItem[]
): ShownToast[] {
  const current = new Map(toasts.map((t) => [t.id, t]));
  const next: ShownToast[] = shown.map(({ toast }) => {
    const now = current.get(toast.id);
    return now === undefined
      ? { toast, leaving: true }
      : { toast: now, leaving: false };
  });
  const drawn = new Set(shown.map(({ toast }) => toast.id));
  toasts.forEach((toast, i) => {
    if (drawn.has(toast.id)) return;
    const before =
      i === 0 ? -1 : next.findIndex((s) => s.toast.id === toasts[i - 1].id);
    next.splice(before + 1, 0, { toast, leaving: false });
  });
  return next;
}

// What Toast draws, and a ref callback per toast. After each change the live
// toasts are stacked from the bottom, newest lowest, by transform, so a CSS
// transition carries every move: open, each in full; collapsed (KAN-488), the
// newest in front and the older ones peeking above it.
export function useToastStack(toasts: readonly ToastItem[], open: boolean) {
  const [shown, setShown] = useState<ShownToast[]>(() =>
    toasts.map((toast) => ({ toast, leaving: false }))
  );
  const elements = useRef(new Map<number, HTMLElement>());
  // Toasts drawn at their final place at least once, so a toast is known to
  // be entering the first time it is laid out.
  const placed = useRef(new Set<number>());

  // Adjusted while rendering when the store's list changes, as React
  // advises for state derived from props: no extra commit, no stale frame.
  const [seenToasts, setSeenToasts] = useState(toasts);
  if (seenToasts !== toasts) {
    setSeenToasts(toasts);
    setShown(mergeShown(shown, toasts));
  }

  // A leaving toast is drawn for TOAST_LEAVE_MS, then dropped.
  const leavingIds = shown
    .filter((s) => s.leaving)
    .map((s) => s.toast.id)
    .join(',');
  useEffect(() => {
    if (leavingIds === '') return;
    const ids = new Set(leavingIds.split(',').map(Number));
    const timeout = setTimeout(() => {
      setShown((prev) =>
        prev.filter((s) => !(s.leaving && ids.has(s.toast.id)))
      );
    }, TOAST_LEAVE_MS);
    return () => clearTimeout(timeout);
  }, [leavingIds]);

  useLayoutEffect(() => {
    let below = 0;
    let depth = 0;
    for (let i = shown.length - 1; i >= 0; i -= 1) {
      const { toast, leaving } = shown[i];
      const el = elements.current.get(toast.id);
      if (el === undefined) continue;
      if (leaving) {
        // Out of reach while it fades: no focus, no pointer (React 18 has no
        // inert prop).
        el.setAttribute('inert', '');
        // And it gives up focus, so the stack's blur releases a hold that
        // focus in it made (a removed element sends no blur).
        const active = document.activeElement;
        if (active instanceof HTMLElement && el.contains(active)) active.blur();
        el.style.opacity = '0';
        placed.current.delete(toast.id);
        continue;
      }
      const y = open ? -below : -depth * TOAST_PEEK_PX;
      const scale =
        open || depth === 0 ? '' : ` scale(${1 - depth * TOAST_PEEK_SCALE})`;
      el.dataset.depth = String(depth);
      el.style.zIndex = String(MAX_DEPTH - depth);
      if (!placed.current.has(toast.id)) {
        // Start 12px low and clear, and have the browser take that in before
        // the move, so the transition runs from it.
        el.style.transform = `translateY(${y + TOAST_RISE_PX}px)`;
        el.style.opacity = '0';
        el.getBoundingClientRect();
        placed.current.add(toast.id);
      }
      el.style.transform = `translateY(${y}px)${scale}`;
      el.style.opacity = '1';
      below += el.offsetHeight + TOAST_GAP_PX;
      depth += 1;
    }
  }, [shown, open]);

  const refFor = (id: number) => (el: HTMLElement | null) => {
    if (el === null) elements.current.delete(id);
    else elements.current.set(id, el);
  };

  return { shown, refFor };
}
