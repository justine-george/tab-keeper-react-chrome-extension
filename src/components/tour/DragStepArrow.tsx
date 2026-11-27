import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { css } from '@emotion/react';

import type { RunDragWay } from '../../redux/slices/globalStateSlice';
import { useThemeColors } from '../../hooks/useThemeColors';
import { EASE } from '../../styles/scale';
import { canAnimate, prefersReducedMotion } from '../modals/getStartedMotion';
import { COACH_LAYER } from './coachLayers';
import {
  ARROW_MOTION,
  arrowShape,
  type ArrowShape,
  type Point,
} from './dragArrow';

const SAVED_TAB = '[data-pane="detail"] [data-saved-tab-row]';
const LIVE_WINDOW = '[data-pane="open-now"] [data-open-window-id]';
const LIVE_TAB = '[data-open-tab-id]';
const TITLE = 'button > div:last-child span';
// Past a saved tab's title, and short of a live tab's row.
const TITLE_GAP = 14;
const ROW_GAP = 13;

// A drag of any kind: rows moved in a list, or carried between panes.
const MOVING = ['data-dragging', 'data-carrying'];
const isMoving = (): boolean =>
  MOVING.some((name) => document.documentElement.hasAttribute(name));
function onMoving(change: () => void): () => void {
  const watch = new MutationObserver(change);
  watch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: MOVING,
  });
  return () => watch.disconnect();
}

function scrollerOf(el: Element): Element | null {
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === 'auto' || overflowY === 'scroll') return at;
  }
  return null;
}

// All of the row on screen, not scrolled out of its list.
function isInView(row: Element): boolean {
  const r = row.getBoundingClientRect();
  if (r.height === 0) return false;
  const scroller = scrollerOf(row)?.getBoundingClientRect();
  const top = Math.max(0, scroller?.top ?? 0);
  const bottom = Math.min(window.innerHeight, scroller?.bottom ?? Infinity);
  return r.top >= top - 1 && r.bottom <= bottom + 1;
}

// Just past the end of a saved tab's title, level with the row's middle.
function pastTitle(row: Element): Point {
  const r = row.getBoundingClientRect();
  const title = row.querySelector(TITLE)?.getBoundingClientRect();
  const button = row.querySelector('button')?.getBoundingClientRect();
  const end = Math.min(title?.right ?? r.left, button?.right ?? r.right);
  return { x: end + TITLE_GAP, y: r.top + r.height / 2 };
}

// Into a window other than this one when there is one: a tab dropped into
// This window would open behind the tour.
function liveTabs(): Element[] {
  const windows = [...document.querySelectorAll(LIVE_WINDOW)];
  const tabsOf = (w: Element) => [...w.querySelectorAll(LIVE_TAB)];
  const target =
    windows.find(
      (w) => !w.hasAttribute('data-this-window') && tabsOf(w).length > 0
    ) ?? windows.find((w) => tabsOf(w).length > 0);
  return target === undefined ? [] : tabsOf(target);
}

// The arrow for `way` as the rows stand now; none when an end is out of view.
function measure(way: RunDragWay): ArrowShape | null {
  const saved = [...document.querySelectorAll(SAVED_TAB)];
  const live = liveTabs();
  const tab = way === 'opened' ? saved[0] : saved[saved.length - 1];
  const other = way === 'opened' ? live[0] : live[live.length - 1];
  if (tab === undefined || other === undefined) return null;
  if (!isInView(tab) || !isInView(other)) return null;
  const o = other.getBoundingClientRect();
  return way === 'opened'
    ? arrowShape(way, pastTitle(tab), { x: o.left - ROW_GAP, y: o.bottom })
    : arrowShape(
        way,
        { x: o.left - ROW_GAP, y: o.top + o.height / 2 },
        pastTitle(tab)
      );
}

const layerStyle = css`
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: ${COACH_LAYER.MARK};
  overflow: visible;
  pointer-events: none;
`;

interface ArrowProps {
  way: RunDragWay;
  shape: ArrowShape;
  isHidden: boolean;
  delay: number;
}

function Arrow({ way, shape, isHidden, delay }: ArrowProps) {
  const COLORS = useThemeColors();
  const group = useRef<SVGGElement>(null);

  // M2. The line traces the drag; the head comes at its end. Kept at the end (fill).
  useLayoutEffect(() => {
    const g = group.current;
    if (g === null || prefersReducedMotion() || !canAnimate(g)) return;
    for (const line of g.querySelectorAll('[data-stroke="line"]')) {
      line.animate(
        [
          { strokeDasharray: '1 1', strokeDashoffset: 1 },
          { strokeDasharray: '1 1', strokeDashoffset: 0 },
        ],
        {
          duration: ARROW_MOTION.DRAW_MS,
          delay,
          easing: EASE.OUT,
          fill: 'both',
        }
      );
    }
    for (const head of g.querySelectorAll('[data-stroke="head"]')) {
      head.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: ARROW_MOTION.HEAD_MS,
        delay: delay + ARROW_MOTION.DRAW_MS - ARROW_MOTION.HEAD_MS,
        fill: 'both',
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, as it mounts

  // H1. Out on pick-up; the style holds it out once the fade ends. One that
  // mounts hidden (the way changed mid-drag) was never seen: no fade.
  const wasShown = useRef(!isHidden);
  useLayoutEffect(() => {
    const g = group.current;
    const fades = isHidden && wasShown.current;
    wasShown.current = !isHidden;
    if (!fades || g === null || prefersReducedMotion() || !canAnimate(g))
      return;
    g.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: ARROW_MOTION.HIDE_MS,
      easing: EASE.OUT,
    });
  }, [isHidden]);

  // The halo, in the page's color, keeps the ink clear over row text.
  const stroke = (kind: 'line' | 'head', layer: 'halo' | 'ink') => (
    <path
      d={kind === 'line' ? shape.line : shape.head}
      data-stroke={kind}
      data-drag-arrow-line={kind === 'line' && layer === 'ink' ? '' : undefined}
      pathLength={1}
      fill="none"
      stroke={layer === 'ink' ? COLORS.TEXT_COLOR : COLORS.PRIMARY_COLOR}
      strokeWidth={layer === 'ink' ? 2 : 6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
  return (
    <g
      ref={group}
      data-drag-arrow-way={way}
      data-drag-arrow-state={isHidden ? 'hidden' : 'drawn'}
      style={{ opacity: isHidden ? 0 : 1 }}
    >
      {stroke('line', 'halo')}
      {stroke('head', 'halo')}
      {stroke('line', 'ink')}
      {stroke('head', 'ink')}
    </g>
  );
}

// KAN-1030. The drag step's arrow for the way still to try (pick B), redrawn
// from the rows each frame so it follows them as they move.
export default function DragStepArrow({ way }: { way: RunDragWay | null }) {
  const [shape, setShape] = useState<ArrowShape | null>(null);
  const isHeld = useSyncExternalStore(onMoving, isMoving);
  const [isHidden, setIsHidden] = useState(isHeld);
  // Each draw-on after a drop is a new arrow; the first waits for the card.
  const [draws, setDraws] = useState(0);
  const wasHeld = useRef(false);

  // Before paint, so a new way never shows the last way's shape.
  useLayoutEffect(() => {
    if (way === null) return;
    let frame = 0;
    let last: string | null = null;
    const follow = () => {
      const next = measure(way);
      const key = next === null ? null : next.line;
      if (key !== last) {
        last = key;
        setShape(next);
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [way]);

  useEffect(() => {
    if (isHeld) {
      wasHeld.current = true;
      setIsHidden(true); // eslint-disable-line react-hooks/set-state-in-effect -- follows the page's drag flag
      return;
    }
    if (!wasHeld.current) return;
    const timer = window.setTimeout(() => {
      wasHeld.current = false;
      setIsHidden(false);
      setDraws((n) => n + 1);
    }, ARROW_MOTION.AFTER_DROP_MS);
    return () => window.clearTimeout(timer);
  }, [isHeld]);

  if (way === null) return null;
  return (
    <svg data-drag-arrow="" aria-hidden="true" css={layerStyle}>
      {shape !== null && (
        <Arrow
          key={`${way}-${draws}`}
          way={way}
          shape={shape}
          isHidden={isHidden}
          delay={draws === 0 ? ARROW_MOTION.FIRST_DELAY_MS : 0}
        />
      )}
    </svg>
  );
}
