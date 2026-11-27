import { useMemo, type MutableRefObject } from 'react';

import { EASE } from '../../styles/scale';
import { canAnimate, prefersReducedMotion } from '../modals/getStartedMotion';
import { lastInputWasKey } from '../../utils/functions/lastInput';

// KAN-982. Menus and dialogs: how they come and go (motion round 1, picks C and B).

/** A menu grows from what opened it: scale 0.96 → 1 with its opacity. */
export const MENU_IN_MS = 160;
/** ...and goes a little faster than it came, to 0.98. */
export const MENU_OUT_MS = 110;
/** A dialog and its dim fade out together. Its way in is dialogRise.ts. */
export const DIALOG_OUT_MS = 150;

export interface LeaveSpec {
  ms: number;
  to: Keyframe;
  /** The dim behind a modal dialog, to fade with it. */
  withDim: boolean;
}

export const MENU_LEAVE: LeaveSpec = {
  ms: MENU_OUT_MS,
  to: { opacity: 0, scale: '0.98' },
  withDim: false,
};
export const DIALOG_LEAVE: LeaveSpec = {
  ms: DIALOG_OUT_MS,
  to: { opacity: 0 },
  withDim: true,
};

// KAN-1033. How a copy leaves, past the menus' and dialogs' defaults.
export interface LeaveOptions {
  /** Where a `scale` in the spec shrinks toward; the element's own origin otherwise. */
  origin?: string;
  /** Leaves with motion after a key too (the tour's Esc). */
  afterKey?: boolean;
  /** Under reduced motion, fades (no scale) instead of going at once. */
  fadeWhenReduced?: boolean;
  /** The copy's `data-leaving-copy` value, to tell copies apart. */
  as?: string;
  /** Holds still this long before it goes. */
  delay?: number;
}

// A key opens and closes at once; so does reduced motion, and an engine with no Web Animations.
const stillnessWanted = (el: Element) =>
  prefersReducedMotion() || lastInputWasKey() || !canAnimate(el);

/**
 * Grows a menu that just opened from `origin` (a transform-origin, relative
 * to the menu). Call once it is placed. Cuts any menu still fading out.
 */
export function growMenuIn(el: HTMLElement, origin: string): void {
  cutLeaving();
  if (stillnessWanted(el)) return;
  el.style.transformOrigin = origin;
  el.animate(
    [
      { opacity: 0, scale: '0.96' },
      { opacity: 1, scale: '1' },
    ],
    { duration: MENU_IN_MS, easing: EASE.OUT }
  );
}

const leaving = new Set<() => void>();

/** Ends every fade-out now: a new menu opening must not sit beside the last one's ghost. */
export function cutLeaving(): void {
  for (const end of [...leaving]) end();
}

// Hooks tests and other code find things by. A copy carries none of them.
const isHook = (name: string) =>
  name === 'id' ||
  name === 'role' ||
  name === 'tabindex' ||
  name === 'autofocus' ||
  name === 'open' ||
  name.startsWith('aria-') ||
  (name.startsWith('data-') && name !== 'data-key-hint');

export function stripHooks(root: Element): void {
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const { name } of [...node.attributes]) {
      if (isHook(name)) node.removeAttribute(name);
    }
  }
}

/**
 * Fades out a copy of `el` where it stands, as `el` itself goes. The copy is
 * inert, hidden from assistive tech, takes no pointer input and carries no
 * role, id, aria or data hook: to everything but the eye, `el` is gone. Its
 * root is a div wearing `el`'s computed style, so it matches no `dialog`
 * selector either. Does nothing under a key, reduced motion, while `el` is
 * still growing in (it just goes), or when `el` has no box.
 *
 * Returns the copy's removal, or null when there is no copy.
 */
export function leaveCopy(
  el: HTMLElement,
  spec: LeaveSpec,
  options: LeaveOptions = {}
): (() => void) | null {
  const reduced = prefersReducedMotion();
  if (reduced && !options.fadeWhenReduced) return null;
  if (!options.afterKey && lastInputWasKey()) return null;
  if (!canAnimate(el) || !el.isConnected) return null;
  const to: Keyframe = reduced ? { opacity: 0 } : spec.to;
  if (el.getAnimations().some((a) => a.playState === 'running')) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  const doc = el.ownerDocument;
  const style = getComputedStyle(el);
  const dimColor = spec.withDim
    ? getComputedStyle(el, '::backdrop').backgroundColor
    : '';

  const copy = doc.createElement('div');
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    copy.style.setProperty(prop, style.getPropertyValue(prop));
  }
  for (const child of [...el.childNodes]) copy.append(child.cloneNode(true));
  copy.className = el.className;
  stripHooks(copy);
  Object.assign(copy.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    boxSizing: 'border-box',
    transform: 'none',
    translate: 'none',
    scale: 'none',
    animation: 'none',
    transition: 'none',
    visibility: 'visible',
    opacity: '1',
    pointerEvents: 'none',
    zIndex: '2147483647',
  });
  copy.style.transformOrigin = options.origin ?? style.transformOrigin;
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  copy.dataset.leavingCopy = options.as ?? '';

  const parts: HTMLElement[] = [copy];
  if (dimColor !== '' && dimColor !== 'rgba(0, 0, 0, 0)') {
    const dim = doc.createElement('div');
    Object.assign(dim.style, {
      position: 'fixed',
      inset: '0',
      background: dimColor,
      pointerEvents: 'none',
      zIndex: '2147483646',
    });
    dim.inert = true;
    dim.setAttribute('aria-hidden', 'true');
    dim.dataset.leavingCopy = '';
    parts.unshift(dim);
  }

  const end = () => {
    leaving.delete(end);
    for (const part of parts) part.remove();
  };
  leaving.add(end);
  doc.body.append(...parts);
  const timing = {
    duration: spec.ms,
    delay: options.delay ?? 0,
    easing: EASE.OUT,
    fill: 'forwards' as const,
  };
  // Only what `to` names: a scale would make the copy the containing block of
  // a fixed child (PinGuide's arrow) and carry it off its place.
  const from: Keyframe = { opacity: 1 };
  if ('scale' in to) from.scale = '1';
  const fade = copy.animate([from, to], timing);
  for (const part of parts.slice(0, -1)) {
    part.animate([{ opacity: 1 }, { opacity: 0 }], timing);
  }
  fade.finished.then(end, end);
  return end;
}

/**
 * A callback ref that fades a copy out when its element leaves the page.
 * React calls a ref with null while the element is still attached, which is
 * the last moment it can be copied. `into` also receives the element, for a
 * component that keeps its own ref object. A modal dialog already closed by hand
 * (`open` false) is not copied: it has already gone from the screen.
 */
export function useLeaveRef<T extends HTMLElement>(
  spec: LeaveSpec,
  into?: MutableRefObject<T | null>
): (el: T | null) => void {
  return useMemo(() => leaveRefFor(spec, into), [spec, into]);
}

// The ref behind useLeaveRef: remembers its element, so the null call can copy it.
function leaveRefFor<T extends HTMLElement>(
  spec: LeaveSpec,
  into: MutableRefObject<T | null> | undefined
): (el: T | null) => void {
  let current: T | null = null;
  return (el) => {
    const prev = current;
    current = el;
    if (into) into.current = el;
    if (el !== null || prev === null) return;
    if (prev instanceof HTMLDialogElement && !prev.open) return;
    const end = leaveCopy(prev, spec);
    // A ref let go of an element that stays (a remount in place): no fade.
    if (end) queueMicrotask(() => prev.isConnected && end());
  };
}
