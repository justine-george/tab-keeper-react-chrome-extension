import { DURATION, EASE } from '../../../../styles/scale';

// KAN-836. A drop into another window: the source window keeps the row's
// room until the move is drawn (KAN-184), then the room closes and every
// window block below the source moves up a row. Blocks carry no transition (their shift
// is subtracted as a number while a drag runs), so in the commit that draws
// the move they glide instead, from where the drop showed them -- and the
// dropped row with its block, from where it was let go.

// The id settleSlides finishes, so a drag that starts mid-glide measures the
// blocks at rest.
export const LANDING_SLIDE = 'landing-slide';

const BLOCK = '[data-drop-window-id]';
// KAN-836. How a window block glides when a closed source room moves it.
const BLOCK_EASING = 'ease';

// Where the drop showed things: each window block's top by its window id, and
// the dropped row's. Measured from the list's own top, so a scroll while the
// drop waits for its move moves nothing here.
export interface LandingTops {
  blocks: ReadonlyMap<string, number>;
  row: number | null;
}

const topIn = (root: Element, el: Element) =>
  el.getBoundingClientRect().top - root.getBoundingClientRect().top;

export function landingTops(
  root: Element | null,
  row: Element | undefined
): LandingTops {
  const blocks = new Map<string, number>();
  if (root === null) return { blocks, row: null };
  root.querySelectorAll<HTMLElement>(BLOCK).forEach((el) => {
    const id = el.dataset.dropWindowId;
    if (id !== undefined) blocks.set(id, topIn(root, el));
  });
  return { blocks, row: row === undefined ? null : topIn(root, row) };
}

// In the commit that drew the move, before it paints. With Reduce motion on, nothing glides.
// KAN-822. A dropped row in a window glides from where it was let go, within its window too; the rows that made room stay put (KAN-835).
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
  // the row inside it, from its first frame. A block the drop made (a new
  // window) moves with the block above it, so the two never overlap.
  const moved = new Map<Element, number>();
  let above = 0;
  root.querySelectorAll<HTMLElement>(BLOCK).forEach((el) => {
    const was = before.blocks.get(el.dataset.dropWindowId ?? '');
    const by = was === undefined ? above : was - topIn(root, el);
    above = by;
    if (Math.abs(by) >= 1) moved.set(el, by);
  });
  const block = row?.closest(BLOCK) ?? null;
  // KAN-822. A row in no window block (a session) lands as before: no glide unless blocks moved.
  if (moved.size === 0 && block === null) return;
  const blockBy = block === null ? undefined : moved.get(block);
  const rowBy =
    row === undefined || before.row === null
      ? 0
      : before.row - topIn(root, row) - (blockBy ?? 0);
  moved.forEach((by, el) => glide(el, by, BLOCK_EASING));
  // KAN-822. Ease-out to settle into its slot; in a gliding block, the block's easing, so the two add up without a wobble.
  if (row !== undefined && Math.abs(rowBy) >= 1)
    glide(row, rowBy, blockBy === undefined ? EASE.OUT : BLOCK_EASING);
}

// From `by` px off its place to its place, as rows step aside. jsdom has no
// Web Animations: there the move is drawn at once.
function glide(el: Element, by: number, easing: string): void {
  if (typeof el.animate !== 'function') return;
  el.animate([{ transform: `translateY(${by}px)` }, { transform: 'none' }], {
    duration: parseInt(DURATION.MOVE, 10),
    easing,
    id: LANDING_SLIDE,
  });
}
