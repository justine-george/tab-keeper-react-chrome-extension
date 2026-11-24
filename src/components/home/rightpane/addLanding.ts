import {
  panes,
  prepareLayoutGlide,
  type GlideKind,
} from '../../common/layoutGlide';

// KAN-993 (his pick C). An add's row comes out from under the row above it,
// as a new session's does. Its landing place is brought into view first, so
// that is seen, not scrolled to after.

const scrollerOf = (el: Element): HTMLElement | null => {
  for (let up = el.parentElement; up !== null; up = up.parentElement) {
    const o = getComputedStyle(up).overflowY;
    if (o === 'auto' || o === 'scroll') return up;
  }
  return null;
};

// How far below its list's visible bottom one more row under `row` would end; 0 when it shows.
const roomShort = (row: Element, scroller: HTMLElement): number => {
  const box = row.getBoundingClientRect();
  const visibleBottom =
    scroller.getBoundingClientRect().top +
    scroller.clientTop +
    scroller.clientHeight;
  return Math.max(0, box.bottom + box.height - visibleBottom);
};

/** Resolves on the next frame: a commit made before it has been drawn. */
export const nextFrame = () =>
  new Promise<void>((done) => requestAnimationFrame(() => done()));

// The first of `selector` in a detail pane on this page.
const inDetail = (selector: string): Element | null => {
  for (const pane of panes('detail')) {
    const found = pane.querySelector(selector);
    if (found !== null) return found;
  }
  return null;
};

/**
 * Brings the place a new row lands into view, then measures the pane for the
 * add's commit. `under` is the row it comes out from under: a window's or a
 * band's title row, one row's room below it shown; null for the top of the
 * list, where a window lands. `kind` is 'fold' when the add also unfolds.
 */
export async function prepareAddLanding(
  under: string | null,
  kind: Extract<GlideKind, 'arrive' | 'fold'> = 'arrive'
): Promise<void> {
  const row = inDetail(under ?? '[data-drop-window-id]');
  const scroller = row === null ? null : scrollerOf(row);
  if (row !== null && scroller !== null) {
    const by = under === null ? -scroller.scrollTop : roomShort(row, scroller);
    if (Math.abs(by) >= 1) {
      scroller.scrollTop += by;
      await nextFrame();
    }
  }
  prepareLayoutGlide(panes('detail'), kind);
}

/** A window's title row, for `prepareAddLanding`. */
export const windowTitleRow = (windowId: string): string =>
  `[data-drop-window-id="${CSS.escape(windowId)}"] [data-window-drag-handle]`;

/** A group band's title row, for `prepareAddLanding`. */
export const bandTitleRow = (groupId: string): string =>
  `[data-band-id="${CSS.escape(groupId)}"] [data-group-drag-handle]`;
