import { EASE } from '../../../styles/scale';
import {
  DIALOG_OUT_MS,
  MENU_IN_MS,
  leaveCopy,
} from '../../common/popoverMotion';
import {
  canAnimate,
  prefersReducedMotion,
} from '../../modals/getStartedMotion';

// KAN-1033 (pick 3-B). The full-view callout grows from its notch with the
// menus' motion and the dashed ring round ⤢ fades in with it; both fade out
// together, as a dialog does. Reduced motion only fades; a key closes at once.

const px = (n: number) => `${Math.round(n * 1000) / 1000}px`;

/** Grows `callout` from the point under the middle of `anchor`, its ring fading in. */
export function growCallout(callout: HTMLElement, anchor: HTMLElement): void {
  if (!canAnimate(callout)) return;
  const reduced = prefersReducedMotion();
  const under = anchor.getBoundingClientRect();
  const left = callout.getBoundingClientRect().left;
  callout.style.transformOrigin = `${px(under.left + under.width / 2 - left)} 0px`;
  const timing = { duration: MENU_IN_MS, easing: EASE.OUT };
  callout.animate(
    reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, scale: '0.96' },
          { opacity: 1, scale: '1' },
        ],
    timing
  );
  anchor.animate(
    [
      { outlineColor: 'rgba(0, 0, 0, 0)' },
      { outlineColor: getComputedStyle(anchor).outlineColor },
    ],
    timing
  );
}

/**
 * A callback ref for the callout: as it leaves, a copy of ⤢'s box (its
 * ring and the callout inside) fades out over the button left behind.
 */
export function calloutLeaveRef(): (el: HTMLElement | null) => void {
  let current: HTMLElement | null = null;
  return (el) => {
    const prev = current;
    current = el;
    if (el !== null || prev === null) return;
    const anchor = prev.parentElement;
    if (anchor === null) return;
    const end = leaveCopy(
      anchor,
      { ms: DIALOG_OUT_MS, to: { opacity: 0 }, withDim: false },
      { fadeWhenReduced: true }
    );
    if (end) queueMicrotask(() => prev.isConnected && end());
  };
}
