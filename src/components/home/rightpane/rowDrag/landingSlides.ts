import { DURATION } from '../../../../styles/scale';

// KAN-836. A drop into a window below its own: the source window keeps the
// row's room until the move is drawn (KAN-184), then the room closes and every
// window block below moves up a row. Blocks carry no transition (their shift
// is subtracted as a number while a drag runs), so in the commit that draws
// the move they glide instead, from where the drop showed them -- and the
// dropped row with its block, from where it was let go.

// The id settleSlides finishes, so a drag that starts mid-glide measures the
// blocks at rest.
export const LANDING_SLIDE = 'landing-slide';

const BLOCK = '[data-drop-window-id]';

// Where the drop showed things: each window block's top by its window id, and
// the dropped row's.
export interface LandingTops {
  blocks: ReadonlyMap<string, number>;
  row: number | null;
}

export function landingTops(
  root: Element | null,
  row: Element | undefined
): LandingTops {
  const blocks = new Map<string, number>();
  root?.querySelectorAll<HTMLElement>(BLOCK).forEach((el) => {
    const id = el.dataset.dropWindowId;
    if (id !== undefined) blocks.set(id, el.getBoundingClientRect().top);
  });
  return { blocks, row: row?.getBoundingClientRect().top ?? null };
}

// In the commit that drew the move, before it paints. Nothing glides when no
// block moved: a drop within a window, or into one above, lands with no
// motion (KAN-835). Nor with Reduce motion on.
export function slideLanding(
  root: Element | null,
  before: LandingTops,
  row: HTMLElement | undefined
): void {
  if (
    root === null ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
    return;
  // Every top is read before any glide starts: a glide moves its block, and
  // the row inside it, from its first frame.
  const moved = new Map<Element, number>();
  root.querySelectorAll<HTMLElement>(BLOCK).forEach((el) => {
    const was = before.blocks.get(el.dataset.dropWindowId ?? '');
    if (was === undefined) return;
    const by = was - el.getBoundingClientRect().top;
    if (Math.abs(by) >= 1) moved.set(el, by);
  });
  if (moved.size === 0) return;
  let rowBy = 0;
  if (row !== undefined && before.row !== null) {
    const block = row.closest(BLOCK);
    rowBy =
      before.row -
      row.getBoundingClientRect().top -
      (block === null ? 0 : (moved.get(block) ?? 0));
  }
  moved.forEach((by, el) => glide(el, by));
  if (row !== undefined && Math.abs(rowBy) >= 1) glide(row, rowBy);
}

// From `by` px off its place to its place, as rows step aside. jsdom has no
// Web Animations: there the move is drawn at once.
function glide(el: Element, by: number): void {
  if (typeof el.animate !== 'function') return;
  el.animate([{ transform: `translateY(${by}px)` }, { transform: 'none' }], {
    duration: parseInt(DURATION.MOVE, 10),
    easing: 'ease',
    id: LANDING_SLIDE,
  });
}
