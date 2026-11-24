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
//   rows below, instead of jumping to its new length;
// - the scroll range is the landed one from the first frame (KAN-985): what
//   glides or fades past the end would otherwise stretch it.
// From the keyboard, under Reduce motion, or with no Web Animations (jsdom),
// nothing moves.

// 'arrive': a new session's row (KAN-988), timed as Undo of a delete draws one.
// 'depart': an arrival taken back (KAN-993): what left goes up the way it came.
export type GlideKind = 'fold' | 'delete' | 'arrive' | 'depart';

// Who made the change: a press here, or another page or device (KAN-991).
// Only a press here can have come from the keyboard.
export type ChangeSource = 'this page' | 'elsewhere';

const TIMING: Record<GlideKind, { out: number; in: number; inDelay: number }> =
  {
    fold: { out: 120, in: 160, inDelay: 40 },
    delete: { out: 150, in: 150, inDelay: 50 },
    arrive: { out: 150, in: 150, inDelay: 50 },
    depart: { out: 150, in: 150, inDelay: 50 },
  };
const GLIDE_MS = parseInt(DURATION.MOVE, 10);

// What moves: a window block, a group band, a saved row (sessions too), a live tab row, a Recently deleted row.
const GLIDERS =
  '[data-drop-window-id], [data-band-id], [data-drag-row-id], [data-open-tab-id], [data-deleted-session-id]';
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

// Whether any of top..bottom is in the window: a fade nobody can see is not drawn.
const inView = (top: number, bottom: number): boolean =>
  bottom > 0 && top < window.innerHeight;

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

// EASE.OUT's control points: cubic-bezier(x1, y1, x2, y2).
const OUT = EASE.OUT.match(/[\d.]+/g)?.map(Number) ?? [0.23, 1, 0.32, 1];
const bezier = (a: number, b: number, t: number) =>
  3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;

/**
 * When, as a share of the glide's time, a line moving from `lineFrom` to
 * `lineTo` on EASE.OUT has passed `y`, counting it passed at 90% of the way
 * (an ease-out spends its last tenth crawling). 0 when it starts past.
 */
export function uncoveredAt(
  y: number,
  lineFrom: number,
  lineTo: number
): number {
  const travel = lineTo - lineFrom;
  if (Math.abs(travel) < 1) return 0;
  const share = Math.min(0.9, Math.max(0, (y - lineFrom) / travel));
  if (share === 0) return 0;
  // Along the curve's own parameter, both progress and time only grow.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(OUT[1], OUT[3], mid) < share) lo = mid;
    else hi = mid;
  }
  return bezier(OUT[0], OUT[2], hi);
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
  name === 'data-deleted-session-id' ||
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
// Each held scroll content and its own inline overflow, put back when the glide ends.
const held = new Map<HTMLElement, { overflow: string; margin: string }>();
let holdId = 0;

function releaseScrollRange(): void {
  held.forEach(({ overflow, margin }, content) => {
    content.style.overflow = overflow;
    content.style.overflowClipMargin = margin;
  });
  held.clear();
}

// The scroll areas holding `els` that have a single child: the list they scroll.
function scrolledContents(root: Element, els: Iterable<Element>): Element[] {
  const scrollers: Element[] = [];
  for (const el of els) {
    if (scrollers.some((sc) => sc.contains(el))) continue;
    for (let up = el.parentElement; up !== null; up = up.parentElement) {
      const o = getComputedStyle(up).overflowY;
      if (o === 'auto' || o === 'scroll') {
        scrollers.push(up);
        break;
      }
      if (up === root) break;
    }
  }
  return scrollers.flatMap((sc) =>
    sc.childElementCount === 1 && sc.firstElementChild !== null
      ? [sc.firstElementChild]
      : []
  );
}

/** Ends every glide, fade and copy now: a drag measures the list at rest. */
export function cutLayoutGlides(): void {
  pending?.();
  releaseScrollRange();
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

const wantsStillness = (source: ChangeSource): boolean =>
  (source === 'this page' && lastInputWasKey()) ||
  typeof Element.prototype.animate !== 'function' ||
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/** Every pane named `name` ([data-pane]): the popup and the tab view each draw their own. None without a document. */
export const panes = (name: 'detail' | 'sessions' | 'open-now'): Element[] =>
  typeof document === 'undefined'
    ? []
    : [...document.querySelectorAll(`[data-pane="${name}"]`)];

/** Measures `roots` now and draws the next commit that changes them as a glide. */
export function prepareLayoutGlide(
  roots: readonly Element[],
  kind: GlideKind,
  source: ChangeSource = 'this page'
): void {
  // A newer press wins; what is still moving keeps moving until its commit (step 0 below).
  pending?.();
  const live = roots.filter((r) => r.isConnected);
  if (live.length === 0 || wantsStillness(source)) return;
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
  const arrivedSet = new Set(arrived);
  const outermost = (el: Element): boolean => {
    for (let up = parentOf(el); up !== null; up = parentOf(up)) {
      if (arrivedSet.has(up)) return false;
    }
    return true;
  };
  // Where each scrolled list is clipped while things glide: its end, or the
  // visible bottom when it ends above that, so nothing on screen is cut.
  const holds = scrolledContents(root, [...tops.keys(), ...arrived]).flatMap(
    (content) => {
      const sc = content.parentElement;
      if (!(content instanceof HTMLElement) || sc === null) return [];
      const visibleBottom =
        sc.getBoundingClientRect().top + sc.clientTop + sc.clientHeight;
      const end = content.getBoundingClientRect().bottom;
      return [{ content, margin: Math.max(0, Math.ceil(visibleBottom - end)) }];
    }
  );
  const arrivalBoxes = arrived
    .filter(outermost)
    .map((el) => ({ el, box: boxOf(el) }))
    .filter(({ box }) => inView(box.top, box.bottom));
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
    const bottom = Math.max(...inside.map(([, b]) => b.bottom));
    if (!inView(box.top, bottom)) return [];
    return [
      {
        node,
        parent,
        next,
        path: pathTo(node, first),
        box,
        width: parent.clientWidth,
      },
    ];
  });

  // From a row's top to the top of the next row below it, where it is now; its own height when none.
  const pitchAt = (box: Box): number => {
    let next = Infinity;
    for (const { to } of tops.values()) {
      if (to >= box.bottom - 1 && to < next) next = to;
    }
    return (Number.isFinite(next) ? next : box.bottom) - box.top;
  };

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
  const hold = ++holdId;
  holds.forEach(({ content, margin }) => {
    if (!held.has(content))
      held.set(content, {
        overflow: content.style.overflow,
        margin: content.style.overflowClipMargin,
      });
    content.style.overflow = 'clip';
    content.style.overflowClipMargin = `${margin}px`;
  });
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
  // The tops of the rows that were there before, where they are now.
  const stayers = [...tops.values()].map(({ to }) => to);
  // A row that comes back is never clipped: Chrome can draw a clip-path
  // animation's first frame again as it ends, a one-frame flash of the rows
  // hidden. It waits instead until the rows gliding down have all but passed it.
  arrivalBoxes.forEach(({ el, box }) => {
    const line = lineBelow(box.bottom, false);
    // KAN-988 (his picks B, rounds 4 and 5). A new session at the top of its
    // list comes down out from under the list's top edge: with the rows below
    // it, or, when they made room already (a drop's open gap), into that room.
    // Never half there, so it cannot read as a flash. Several new at the top
    // come down together, as one (KAN-991 pick A).
    const by = line !== null ? line.to - line.from : pitchAt(box);
    if (kind === 'arrive' && by >= 1 && onlyArrivalsAbove(el, box, stayers)) {
      el.animate(
        [{ transform: `translateY(${-by}px)` }, { transform: 'none' }],
        { duration: GLIDE_MS, easing: EASE.OUT, id: LANDING_SLIDE }
      );
      return;
    }
    // KAN-991 (pick C). Lower down, the row above is the edge it comes out
    // from under, as the list's top edge is above.
    if (kind === 'arrive' && el instanceof HTMLElement) {
      slideOutFromUnder(el, box.bottom - box.top);
      return;
    }
    const wait =
      line === null
        ? 0
        : uncoveredAt(box.bottom, line.from, line.to) * GLIDE_MS;
    el.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      timing(t.in, Math.max(t.inDelay, wait))
    );
  });
  // Copies in three passes (insert, measure, place) so a Collapse all lays out twice, not per copy.
  const placed = leaving.flatMap(({ node, parent, next, path, box, width }) => {
    if (!parent.isConnected) return [];
    const copy = node.cloneNode(true);
    const twin = copy instanceof Element ? follow(copy, path) : null;
    if (!(copy instanceof HTMLElement) || twin === null) return [];
    stripHooks(copy);
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    copy.dataset.leavingRow = '';
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
    return [{ copy, twin, box, width }];
  });
  // Laid out where it lands, widened so its first row is as wide as that row was.
  const widths = placed.map(({ twin }) => twin.getBoundingClientRect().width);
  placed.forEach(({ copy, box, width }, i) => {
    copy.style.width = `${width + box.width - widths[i]}px`;
  });
  const at = placed.map(({ copy, twin }) => ({
    twin: twin.getBoundingClientRect(),
    copy: copy.getBoundingClientRect(),
  }));
  placed.forEach(({ copy, box }, i) => {
    // Then moved so its first row sits on that row's old box.
    const dx = box.left - at[i].twin.left;
    const dy = box.top - at[i].twin.top;
    copy.style.left = `${dx}px`;
    copy.style.top = `${dy}px`;
    const end = () => {
      copies.delete(copy);
      copy.remove();
    };
    const top = at[i].copy.top + dy;
    const bottom = at[i].copy.bottom + dy;
    const line = lineBelow(bottom, true);
    // KAN-993 (his pick B, round 1b). An add taken back goes up under the row
    // above, as far as the rows below come up, and never fades: its arrival
    // played backwards.
    if (kind === 'depart') {
      copy.style.overflow = 'clip';
      const by = line === null ? bottom - top : line.from - line.to;
      const slides = [...copy.children].map((child) =>
        child.animate(
          [{ transform: 'none' }, { transform: `translateY(${-by}px)` }],
          { ...timing(GLIDE_MS), fill: 'forwards' }
        )
      );
      Promise.all(slides.map((a) => a.finished)).then(end, end);
      return;
    }
    const fade = copy.animate([{ opacity: 1 }, { opacity: 0 }], {
      ...timing(t.out),
      fill: 'forwards',
    });
    const clip =
      line === null ? null : clipAboveLine(top, bottom, line.from, line.to);
    const cut =
      clip === null
        ? null
        : copy.animate(clip, { ...timing(GLIDE_MS), fill: 'forwards' });
    Promise.all([fade.finished, cut?.finished]).then(end, end);
  });
  // The range is let go once everything this glide drew has landed (or a newer glide took over).
  const drawn = root
    .getAnimations({ subtree: true })
    .filter((a) => a.id === LAYOUT_GLIDE || a.id === LANDING_SLIDE);
  const release = () => {
    if (hold === holdId) releaseScrollRange();
  };
  Promise.all(drawn.map((a) => a.finished)).then(release, release);
}

// Whether nothing but new rows shows between `box` and its scroll area's
// visible top: none of the rows that were there (`stayers`, their tops now).
function onlyArrivalsAbove(
  el: Element,
  box: Box,
  stayers: readonly number[]
): boolean {
  for (let up = el.parentElement; up !== null; up = up.parentElement) {
    const o = getComputedStyle(up).overflowY;
    if (o === 'auto' || o === 'scroll') {
      const top = up.getBoundingClientRect().top + up.clientTop;
      if (box.top < top - 1) return false;
      return !stayers.some((y) => y >= top - 1 && y < box.top - 1);
    }
  }
  return false;
}

// A new row below the top of its list: its own box clips it, as the list's
// top edge clips a row at the top, while what it holds comes down into it,
// out from under the row above. The clip is a style held for the glide, not
// an animated clip-path: Chrome can redraw such an animation's first frame as
// it ends, and on a row that stays that is a flash (KAN-984).
function slideOutFromUnder(row: HTMLElement, by: number): void {
  if (by < 1) return;
  const overflow = row.style.overflow;
  row.style.overflow = 'clip';
  const slides = [...row.children].map((child) =>
    child.animate(
      [{ transform: `translateY(${-by}px)` }, { transform: 'none' }],
      { duration: GLIDE_MS, easing: EASE.OUT, id: LANDING_SLIDE }
    )
  );
  const end = () => {
    row.style.overflow = overflow;
  };
  Promise.all(slides.map((a) => a.finished)).then(end, end);
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
