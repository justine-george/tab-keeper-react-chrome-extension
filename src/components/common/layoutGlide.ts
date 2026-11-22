import { DURATION, EASE } from '../../styles/scale';
import { lastInputWasKey } from '../../utils/functions/lastInput';
import { LANDING_SLIDE } from '../home/rightpane/rowDrag/landingSlides';

// KAN-984 (picks fold B, delete C). A fold or a delete changes a list's
// layout in one commit; this draws the change as motion. Call it just before
// the dispatch: it measures the pane, waits for the commit that changes it,
// and then, before that commit paints:
// - every row, band and window block that moved glides from where it was
//   (the drop glides' own animation, so a drag starting mid-glide finishes
//   it first: settleSlides);
// - what left fades out where it stood, as a copy no code can find, cut off
//   by the rows gliding up over its place;
// - what arrived fades in, uncovered as the rows below glide down;
// - a group's colour strip keeps its old length and moves its end with the
//   rows below, instead of jumping to its new length.
// From the keyboard, under Reduce motion, or with no Web Animations (jsdom),
// nothing moves.

export type GlideKind = 'fold' | 'delete';

const TIMING: Record<GlideKind, { out: number; in: number; inDelay: number }> =
  {
    fold: { out: 120, in: 160, inDelay: 40 },
    delete: { out: 150, in: 150, inDelay: 50 },
  };
const GLIDE_MS = parseInt(DURATION.MOVE, 10);

// What moves: a window block, a group band, a saved row (sessions too), a live tab row.
const GLIDERS =
  '[data-drop-window-id], [data-band-id], [data-drag-row-id], [data-open-tab-id]';
const STRIP = '[data-group-color-strip]';
// An intent no commit answers (a refused delete) is dropped after this.
const WAIT_MS = 1500;

// The fade-ins and strip moves; the glides use LANDING_SLIDE.
export const LAYOUT_GLIDE = 'layout-glide';

interface Box {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, width: r.width };
};

/**
 * Each element's own glide: how far it was moved, less what the nearest
 * gliding element around it already carries it. `moved` is old top minus new
 * top; only moves of a pixel or more glide.
 */
export function ownShifts<T>(
  moved: ReadonlyMap<T, number>,
  parentOf: (el: T) => T | null
): Map<T, number> {
  const own = new Map<T, number>();
  const carried = (el: T): number => {
    for (let p = parentOf(el); p !== null; p = parentOf(p)) {
      const by = moved.get(p);
      if (by !== undefined && Math.abs(by) >= 1) return by;
    }
    return 0;
  };
  moved.forEach((by, el) => {
    if (Math.abs(by) < 1) return;
    const shift = by - carried(el);
    if (Math.abs(shift) >= 1) own.set(el, shift);
  });
  return own;
}

/**
 * The clip that keeps a region [top, bottom] clear of a line moving from
 * `lineFrom` to `lineTo` over the glide: only the part above the line shows.
 * Keyframe offsets are the glide's eased progress, so the edge tracks the
 * gliding rows exactly. Null when the line never crosses the region.
 */
export function clipAboveLine(
  top: number,
  bottom: number,
  lineFrom: number,
  lineTo: number
): Keyframe[] | null {
  const height = bottom - top;
  const hidden = (line: number) => Math.min(height, Math.max(0, bottom - line));
  const travel = lineTo - lineFrom;
  if (height <= 0 || Math.abs(travel) < 1) return null;
  if (hidden(lineFrom) === 0 && hidden(lineTo) === 0) return null;
  // Where the line meets the region's bottom and top, as progress.
  const at = (y: number) => Math.min(1, Math.max(0, (y - lineFrom) / travel));
  const stops = [0, at(bottom), at(top), 1].sort((a, b) => a - b);
  const frames: Keyframe[] = [];
  for (const offset of stops) {
    if (frames.length > 0 && frames[frames.length - 1].offset === offset)
      continue;
    const line = lineFrom + travel * offset;
    frames.push({ offset, clipPath: `inset(0 0 ${hidden(line)}px 0)` });
  }
  return frames;
}

// Hooks code and specs find things by. A copy carries none of them.
const isHook = (name: string) =>
  name === 'id' ||
  name === 'role' ||
  name === 'tabindex' ||
  name.startsWith('aria-') ||
  name === 'data-drop-window-id' ||
  name === 'data-band-id' ||
  name === 'data-drag-row-id' ||
  name === 'data-open-tab-id' ||
  name === 'data-saved-tab-row' ||
  name === 'data-window-tabs' ||
  name === 'data-group-color-strip' ||
  name.startsWith('data-drag') ||
  name.startsWith('data-tour') ||
  name === 'data-testid';

function stripHooks(root: Element): void {
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const { name } of [...node.attributes]) {
      if (isHook(name)) node.removeAttribute(name);
    }
  }
}

const copies = new Set<HTMLElement>();
let pending: (() => void) | null = null;

/** Ends every glide, fade and copy now: a drag measures the list at rest. */
export function cutLayoutGlides(): void {
  pending?.();
  for (const copy of [...copies]) copy.remove();
  copies.clear();
  for (const a of globalThis.document?.getAnimations?.() ?? []) {
    if (a.id === LAYOUT_GLIDE) a.cancel();
  }
}

interface Snapshot {
  boxes: Map<Element, Box>;
  strips: Map<Element, number>;
}

function snapshot(root: Element): Snapshot {
  const boxes = new Map<Element, Box>();
  root.querySelectorAll(GLIDERS).forEach((el) => boxes.set(el, boxOf(el)));
  const strips = new Map<Element, number>();
  root
    .querySelectorAll(STRIP)
    .forEach((el) => strips.set(el, el.getBoundingClientRect().height));
  return { boxes, strips };
}

const wantsStillness = (): boolean =>
  lastInputWasKey() ||
  typeof Element.prototype.animate !== 'function' ||
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/** Every pane named `name` ([data-pane]): the popup and the tab view each draw their own. */
export const panes = (name: 'detail' | 'sessions' | 'open-now'): Element[] => [
  ...document.querySelectorAll(`[data-pane="${name}"]`),
];

/** Measures `roots` now and draws the next commit that changes them as a glide. */
export function prepareLayoutGlide(
  roots: readonly Element[],
  kind: GlideKind
): void {
  // A newer press wins; what is still moving keeps moving until its commit (step 0 below).
  pending?.();
  if (wantsStillness()) return;
  const live = roots.filter((r) => r.isConnected);
  if (live.length === 0) return;
  const watches = live.map((root) => {
    const before = snapshot(root);
    const removed: { node: Element; parent: Node; next: Node | null }[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.removedNodes.forEach((node) => {
          if (node instanceof Element)
            removed.push({
              node,
              parent: record.target,
              next: record.nextSibling,
            });
        });
      }
      if (!changed(root, before)) return;
      stop();
      draw(root, before, removed, kind);
    });
    observer.observe(root, { childList: true, subtree: true });
    return observer;
  });
  const timer = window.setTimeout(() => stop(), WAIT_MS);
  const stop = () => {
    watches.forEach((o) => o.disconnect());
    window.clearTimeout(timer);
    if (pending === stop) pending = null;
  };
  pending = stop;
}

// Whether the commit moved, removed or added anything that glides.
function changed(root: Element, before: Snapshot): boolean {
  for (const [el, box] of before.boxes) {
    if (!el.isConnected) return true;
    if (Math.abs(el.getBoundingClientRect().top - box.top) >= 1) return true;
  }
  for (const el of root.querySelectorAll(GLIDERS)) {
    if (!before.boxes.has(el)) return true;
  }
  return false;
}

const timing = (ms: number, delay = 0): KeyframeAnimationOptions => ({
  duration: ms,
  delay,
  easing: EASE.OUT,
  fill: 'backwards',
  id: LAYOUT_GLIDE,
});

function draw(
  root: Element,
  before: Snapshot,
  removed: readonly { node: Element; parent: Node; next: Node | null }[],
  kind: GlideKind
): void {
  const t = TIMING[kind];
  // 0. A glide still running from the last press stops where the snapshot saw it, so this one starts there.
  cutLayoutGlides();
  for (const a of root.getAnimations({ subtree: true })) {
    if (a.id === LANDING_SLIDE) a.cancel();
  }
  // 1. Every read first: a glide moves its element from its first frame.
  const tops = new Map<Element, { from: number; to: number }>();
  before.boxes.forEach((box, el) => {
    if (el.isConnected)
      tops.set(el, { from: box.top, to: el.getBoundingClientRect().top });
  });
  const moved = new Map([...tops].map(([el, { from, to }]) => [el, from - to]));
  const parentOf = (el: Element): Element | null =>
    el.parentElement?.closest(GLIDERS) ?? null;
  const own = ownShifts(moved, parentOf);
  const arrived = [...root.querySelectorAll(GLIDERS)].filter(
    (el) => !before.boxes.has(el)
  );
  // Only the outermost arrival fades; its rows come with it.
  const arrivals = arrived.filter(
    (el) => !arrived.some((other) => other !== el && other.contains(el))
  );
  const arrivalBoxes = arrivals.map((el) => ({ el, box: boxOf(el) }));
  const strips: { el: HTMLElement; by: number }[] = [];
  before.strips.forEach((height, el) => {
    if (!el.isConnected || !(el instanceof HTMLElement)) return;
    const by = el.getBoundingClientRect().height - height;
    if (Math.abs(by) >= 1) strips.push({ el, by });
  });
  // What left: each removed root that held something that glided, placed by the first of those.
  const leaving = removed.flatMap(({ node, parent, next }) => {
    if (node.isConnected || !(parent instanceof HTMLElement)) return [];
    const inside = [...before.boxes].filter(([el]) => node.contains(el));
    if (inside.length === 0) return [];
    const [first, box] = inside.reduce((a, b) => (b[1].top < a[1].top ? b : a));
    return [{ node, parent, next, path: pathTo(node, first), box }];
  });

  // The rows that close over (or open from) a region: the nearest mover below it.
  const lineBelow = (
    bottom: number,
    closing: boolean
  ): { from: number; to: number } | null => {
    let best: { from: number; to: number } | null = null;
    for (const { from, to } of tops.values()) {
      if (Math.abs(from - to) < 1) continue;
      const edge = closing ? from : to;
      if (edge < bottom - 1) continue;
      if (best === null || edge < (closing ? best.from : best.to))
        best = { from, to };
    }
    return best;
  };

  // 2. Then every move.
  own.forEach((by, el) =>
    el.animate([{ transform: `translateY(${by}px)` }, { transform: 'none' }], {
      duration: GLIDE_MS,
      easing: EASE.OUT,
      id: LANDING_SLIDE,
    })
  );
  strips.forEach(({ el, by }) =>
    el.animate([{ marginBottom: `${by}px` }, { marginBottom: '0px' }], {
      ...timing(GLIDE_MS),
      fill: 'none',
    })
  );
  arrivalBoxes.forEach(({ el, box }) => {
    el.animate([{ opacity: 0 }, { opacity: 1 }], timing(t.in, t.inDelay));
    const line = lineBelow(box.bottom, false);
    const clip =
      line === null
        ? null
        : clipAboveLine(box.top, box.bottom, line.from, line.to);
    if (clip !== null) el.animate(clip, { ...timing(GLIDE_MS), fill: 'none' });
  });
  leaving.forEach(({ node, parent, next, path, box }) => {
    if (!parent.isConnected) return;
    const copy = node.cloneNode(true);
    const twin = copy instanceof Element ? follow(copy, path) : null;
    if (!(copy instanceof HTMLElement) || twin === null) return;
    stripHooks(copy);
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    copy.dataset.leavingRow = '';
    const width = parent.clientWidth;
    Object.assign(copy.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: `${width}px`,
      margin: '0',
      pointerEvents: 'none',
      transform: 'none',
    });
    parent.insertBefore(
      copy,
      next !== null && next.parentNode === parent ? next : null
    );
    copies.add(copy);
    // Laid out where it lands, then moved so its first row sits on that row's old box.
    copy.style.width = `${width + box.width - twin.getBoundingClientRect().width}px`;
    const at = twin.getBoundingClientRect();
    copy.style.left = `${box.left - at.left}px`;
    copy.style.top = `${box.top - at.top}px`;
    const own = copy.getBoundingClientRect();
    const end = () => {
      copies.delete(copy);
      copy.remove();
    };
    const fade = copy.animate([{ opacity: 1 }, { opacity: 0 }], {
      ...timing(t.out),
      fill: 'forwards',
    });
    const line = lineBelow(own.bottom, true);
    const clip =
      line === null
        ? null
        : clipAboveLine(own.top, own.bottom, line.from, line.to);
    const cut =
      clip === null
        ? null
        : copy.animate(clip, { ...timing(GLIDE_MS), fill: 'forwards' });
    Promise.all([fade.finished, cut?.finished]).then(end, end);
  });
}

// The child indexes from `root` down to `el`.
function pathTo(root: Element, el: Element): number[] {
  const path: number[] = [];
  for (let at = el; at !== root;) {
    const up = at.parentElement;
    if (up === null) break;
    path.unshift([...up.children].indexOf(at));
    at = up;
  }
  return path;
}

// The element at `path` under `root`, or null when the path leads nowhere.
function follow(root: Element, path: readonly number[]): Element | null {
  let at: Element | undefined = root;
  for (const i of path) at = at?.children.item(i) ?? undefined;
  return at ?? null;
}
