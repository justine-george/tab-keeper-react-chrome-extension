import { EASE } from '../../styles/scale';
import { lastInputWasKey } from '../../utils/functions/lastInput';
import { stripHooks } from '../common/popoverMotion';
import { canAnimate, prefersReducedMotion } from './getStartedMotion';

// KAN-1033 (pick 1-B). Setup's steps: the dialog glides to its new height and
// the step's contents cross-fade, the new ones from the side you went. The
// title row stays; the buttons ride the bottom edge. A key changes the step
// at once; reduced motion only cross-fades.

export const STEP_MOTION = {
  GLIDE_MS: 200,
  OUT_MS: 100,
  IN_MS: 150,
  SHIFT_PX: 8,
  BACK_IN_MS: 120,
} as const;

/** What the dialog showed before a step change, held until the next one draws. */
export interface StepBefore {
  /** The dialog's border-box height. */
  height: number;
  /** The old step's contents: an inert copy, not yet on the page. */
  copy: HTMLElement;
  /** Next's (or Done's) width, 0 with none. */
  nextWidth: number;
  hadBack: boolean;
  /** 1 for Next, -1 for Back. */
  dir: 1 | -1;
  fadeOnly: boolean;
}

const px = (n: number) => `${Math.round(n * 1000) / 1000}px`;

/** Takes the step on screen, before React draws the next; null when the change is to be instant. */
export function holdStep(
  dialog: HTMLElement,
  contents: HTMLElement,
  next: HTMLElement | null,
  hadBack: boolean,
  dir: 1 | -1
): StepBefore | null {
  if (lastInputWasKey() || !canAnimate(dialog)) return null;
  const copy = contents.cloneNode(true) as HTMLElement;
  stripHooks(copy);
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  copy.dataset.stepLeaving = '';
  Object.assign(copy.style, {
    position: 'absolute',
    left: px(contents.offsetLeft),
    top: px(contents.offsetTop),
    width: px(contents.offsetWidth),
    margin: '0',
    pointerEvents: 'none',
    zIndex: '0',
  });
  return {
    height: dialog.getBoundingClientRect().height,
    copy,
    nextWidth: next?.getBoundingClientRect().width ?? 0,
    hadBack,
    dir,
    fadeOnly: prefersReducedMotion(),
  };
}

// The buttons out of the flow, on the bottom edge and over the step, until the glide ends.
function pinToBottom(foot: HTMLElement, dialog: HTMLElement): () => void {
  const style = getComputedStyle(dialog);
  const before = foot.getAttribute('style');
  Object.assign(foot.style, {
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '0',
    margin: '0',
    padding: `0 ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
    background: style.backgroundColor,
    zIndex: '1',
  });
  return () => {
    if (before === null) foot.removeAttribute('style');
    else foot.setAttribute('style', before);
  };
}

/** Plays the change from `was` to the step now drawn. */
export function playStep(
  dialog: HTMLElement,
  contents: HTMLElement,
  foot: HTMLElement,
  next: HTMLElement | null,
  back: HTMLElement | null,
  was: StepBefore
): void {
  const timing = (duration: number) => ({ duration, easing: EASE.OUT });
  const { copy } = was;
  dialog.append(copy);
  const out = copy.animate([{ opacity: 1 }, { opacity: 0 }], {
    ...timing(STEP_MOTION.OUT_MS),
    fill: 'forwards',
  });
  const drop = () => copy.remove();
  out.finished.then(drop, drop);

  const shift = `${STEP_MOTION.SHIFT_PX * was.dir}px 0px`;
  contents.animate(
    was.fadeOnly
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, translate: shift },
          { opacity: 1, translate: '0px 0px' },
        ],
    timing(STEP_MOTION.IN_MS)
  );
  if (back !== null && !was.hadBack) {
    back.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      timing(STEP_MOTION.BACK_IN_MS)
    );
  }
  if (was.fadeOnly) return;

  // Next keeps its right edge as Back takes room beside it.
  const nextNow = next?.getBoundingClientRect().width ?? 0;
  if (
    next !== null &&
    was.nextWidth > 0 &&
    Math.abs(nextNow - was.nextWidth) > 0.5
  ) {
    next.style.justifySelf = 'end';
    const widen = next.animate(
      [{ width: px(was.nextWidth) }, { width: px(nextNow) }],
      timing(STEP_MOTION.GLIDE_MS)
    );
    const settle = () => next.style.removeProperty('justify-self');
    widen.finished.then(settle, settle);
  }

  const height = dialog.getBoundingClientRect().height;
  if (Math.abs(height - was.height) < 0.5) return;
  const unpin = pinToBottom(foot, dialog);
  dialog.style.overflow = 'hidden';
  dialog.style.boxSizing = 'border-box';
  const glide = dialog.animate(
    [{ height: px(was.height) }, { height: px(height) }],
    timing(STEP_MOTION.GLIDE_MS)
  );
  const land = () => {
    unpin();
    dialog.style.removeProperty('overflow');
    dialog.style.removeProperty('box-sizing');
  };
  glide.finished.then(land, land);
}
