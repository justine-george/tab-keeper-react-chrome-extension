import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { DURATION } from '../../../styles/scale';
import {
  type Arrival,
  arrivalBox,
  arrivalRuns,
  nearestScroll,
  subscribeArrival,
} from '../../../utils/functions/arrival';
import type { OpenWindow } from '../../../utils/functions/openNow';
import {
  canAnimate,
  prefersReducedMotion,
} from '../../modals/getStartedMotion';

// Rows Open now has not listed by then are not coming (a search hides them,
// or their window is folded): nothing shows.
export const ARRIVAL_WAIT_MS = 2000;

// Spec D's timings: the fill holds, then fades. Here, not in DURATION: that
// scale keeps no two values alike, and its 300ms is HOVER_INTENT's.
const HOLD_MS = 300;
const SHOWN_MS = HOLD_MS + 600;
const SCROLL_MS = parseFloat(DURATION.FOLD);

const easeOutCubic = (k: number) => 1 - (1 - k) ** 3;

type Run = [HTMLElement, ...HTMLElement[]];

// A dropped window's new rows in their block, one list per run of them next
// to each other (R17), each with every group band all of whose rows are new;
// null until every one of them is listed.
function newRunsIn(block: Element, tabIds: readonly number[]): Run[] | null {
  const idOf = (row: Element) => row.getAttribute('data-open-tab-id') ?? '';
  const rows = [...block.querySelectorAll<HTMLElement>('[data-open-tab-id]')];
  const listed = new Set(rows.map(idOf));
  if (tabIds.length === 0 || tabIds.some((id) => !listed.has(String(id))))
    return null;
  const isNew = new Set(tabIds.map(String));
  const bands = [
    ...block.querySelectorAll<HTMLElement>('[data-band-id]'),
  ].filter((band) => {
    const ids = [...band.querySelectorAll('[data-open-tab-id]')].map((row) =>
      row.getAttribute('data-open-tab-id')
    );
    return ids.length > 0 && ids.every((id) => id !== null && isNew.has(id));
  });
  return arrivalRuns(rows, (row) => isNew.has(idOf(row))).map((run): Run => [
    ...run,
    ...bands.filter((band) => run.some((row) => band.contains(row))),
  ]);
}

function blockOf(pane: Element | null, windowId: number): HTMLElement | null {
  return (
    pane?.querySelector<HTMLElement>(`[data-open-window-id="${windowId}"]`) ??
    null
  );
}

// The scroller's top that shows the new rows, read from where they are now.
function scrollTopShowing(
  scroller: HTMLElement,
  rows: readonly HTMLElement[]
): number {
  const rects = rows.map((row) => row.getBoundingClientRect());
  const span = {
    top: Math.min(...rects.map((r) => r.top)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
  const to =
    scroller.scrollTop + nearestScroll(span, scroller.getBoundingClientRect());
  return Math.max(
    0,
    Math.min(to, scroller.scrollHeight - scroller.clientHeight)
  );
}

// What a user does to scroll the list themselves. Watched, not inferred from
// scrollTop: Chrome's scroll anchoring moves it too when a re-read grows the
// list above what is on screen.
const USER_SCROLLS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

interface Glide {
  isRunning(): boolean;
  stop(): void;
}

// To `aim()` over DURATION.FOLD, ease-out; a jump under Reduce motion. Aimed
// again each frame, so rows a re-read moves mid-glide are still where it ends.
function glide(
  scroller: HTMLElement,
  aim: () => number | null,
  reduced: boolean
): Glide {
  const done: Glide = { isRunning: () => false, stop: () => {} };
  const from = scroller.scrollTop;
  const first = aim();
  if (first === null || Math.abs(first - from) < 1) return done;
  if (reduced) {
    scroller.scrollTop = first;
    return done;
  }
  let start: number | null = null;
  let frame: number | null = null;
  const step = (now: number) => {
    start ??= now;
    const k = Math.min(1, (now - start) / SCROLL_MS);
    const to = aim() ?? first;
    scroller.scrollTop = from + (to - from) * easeOutCubic(k);
    frame = k < 1 ? requestAnimationFrame(step) : null;
  };
  frame = requestAnimationFrame(step);
  return {
    isRunning: () => frame !== null,
    stop: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}

interface Shown {
  // After a re-read: the fills back over their rows, and the list after them.
  fit(): void;
  stop(): void;
}

// The fills are drawn by OpenNowWindow's `[data-arrival]` rule; this places
// one per run, scrolls to them, and takes them away together. While it shows, the list follows
// rows a re-read moves (a group's band drawn after its tabs), until the
// user scrolls it themselves.
function show(
  block: HTMLElement,
  tabIds: readonly number[],
  scroller: HTMLElement
): Shown {
  const reduced = prefersReducedMotion();
  const fills = (newRunsIn(block, tabIds) ?? []).map(() => {
    const fill = document.createElement('div');
    fill.setAttribute('data-arrival', '');
    fill.setAttribute('aria-hidden', 'true');
    block.append(fill);
    return fill;
  });
  const place = () => {
    const runs = newRunsIn(block, tabIds);
    if (runs === null) return;
    const at = block.getBoundingClientRect();
    fills.forEach((fill, i) => {
      const run = runs[i];
      if (run === undefined) return;
      const [first, ...rest] = run;
      const box = arrivalBox(
        [
          first.getBoundingClientRect(),
          ...rest.map((row) => row.getBoundingClientRect()),
        ],
        at
      );
      fill.style.top = `${box.top}px`;
      fill.style.height = `${box.height}px`;
      fill.style.left = `${box.left}px`;
      fill.style.right = `${box.right}px`;
    });
  };
  const aim = () => {
    const runs = newRunsIn(block, tabIds);
    return runs === null ? null : scrollTopShowing(scroller, runs.flat());
  };
  place();
  let scrolling = glide(scroller, aim, reduced);

  let userScrolled = false;
  const onUserScroll = () => {
    userScrolled = true;
    scrolling.stop();
  };
  for (const type of USER_SCROLLS)
    scroller.addEventListener(type, onUserScroll, { passive: true });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const fades: Animation[] = [];
  let ended = false;
  const end = () => {
    ended = true;
    scrolling.stop();
    for (const type of USER_SCROLLS)
      scroller.removeEventListener(type, onUserScroll);
    if (timer !== null) clearTimeout(timer);
    for (const fade of fades) fade.cancel();
    for (const fill of fills) fill.remove();
  };
  if (reduced || !fills.every(canAnimate)) {
    timer = setTimeout(end, SHOWN_MS);
  } else {
    for (const fill of fills)
      fades.push(
        fill.animate(
          [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: HOLD_MS / SHOWN_MS },
            { opacity: 0, offset: 1 },
          ],
          { duration: SHOWN_MS, easing: 'linear' }
        )
      );
    Promise.all(fades.map((fade) => fade.finished)).then(
      end,
      // Cancelled: end() ran already.
      () => {}
    );
  }
  return {
    fit: () => {
      if (ended) return;
      // Its window closed: its detached rows measure 0x0 and would glide the list up.
      if (!block.isConnected) return end();
      place();
      if (!userScrolled && !scrolling.isRunning())
        scrolling = glide(scroller, aim, reduced);
    },
    stop: end,
  };
}

/**
 * KAN-892 D. A saved window dropped on an open window: once Open now lists
 * the tabs it added (`announceArrival`), the list scrolls the least it must
 * to show them, and a fill behind each run of them holds, then fades. Waits
 * for a re-read that lists them all -- read on each `windows` -- for up to
 * ARRIVAL_WAIT_MS. A second arrival replaces the first.
 */
export function useArrival(
  paneRef: RefObject<HTMLElement>,
  scrollerRef: RefObject<HTMLElement>,
  windows: OpenWindow[] | null
): void {
  const [waiting, setWaiting] = useState<Arrival | null>(null);
  const shown = useRef<Shown | null>(null);

  useEffect(() => subscribeArrival((arrival) => setWaiting(arrival)), []);

  useEffect(() => {
    if (waiting === null) return;
    const timer = setTimeout(() => setWaiting(null), ARRIVAL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  // Before paint: the rows a re-read listed are in the page.
  useLayoutEffect(() => {
    const block =
      waiting === null ? null : blockOf(paneRef.current, waiting.windowId);
    const scroller = scrollerRef.current;
    if (
      waiting !== null &&
      block !== null &&
      scroller !== null &&
      newRunsIn(block, waiting.tabIds) !== null
    ) {
      shown.current?.stop();
      shown.current = show(block, waiting.tabIds, scroller);
      setWaiting(null);
      return;
    }
    shown.current?.fit();
  }, [waiting, windows, paneRef, scrollerRef]);

  useEffect(
    () => () => {
      shown.current?.stop();
    },
    []
  );
}
