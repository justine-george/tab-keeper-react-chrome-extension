import { DURATION, EASE } from '../../../../styles/scale';

// KAN-836. A drop into another window: the source window keeps the row's
// room until the move is drawn (KAN-184), then the room closes and every
// window block below the source moves up a row. Blocks carry no transition (their shift
// is subtracted as a number while a drag runs), so in the commit that draws
// the move they glide instead, from where the drop showed them.
// KAN-822. And the dropped row glides into its slot from the card it was let go as, within a window too.

// The id settleSlides finishes, so a drag that starts mid-glide measures the
// blocks at rest.
export const LANDING_SLIDE = 'landing-slide';

const BLOCK = '[data-drop-window-id]';
const BAND = '[data-band-id]';
// KAN-836. How a window block glides when a closed source room moves it.
const BLOCK_EASING = 'ease';

// Where the drop showed things: each window block's top by its window id, and
// the dropped row's. Measured from the list's own top, so a scroll while the
// drop waits for its move moves nothing here.
export interface LandingTops {
  blocks: ReadonlyMap<string, number>;
  row: number | null;
  // KAN-822 (KAN-959). A room held open the drop closes: its window, and the tops there of each band and row by id.
  heldRoom: HeldRoomTops | null;
}

interface HeldRoomTops {
  windowId: string;
  bands: ReadonlyMap<string, number>;
  rows: ReadonlyMap<string, number>;
}

const blockOf = (root: Element, windowId: string): Element | undefined =>
  [...root.querySelectorAll<HTMLElement>(BLOCK)].find(
    (el) => el.dataset.dropWindowId === windowId
  );

const bandsIn = (block: Element | undefined) =>
  new Map(
    [...(block?.querySelectorAll<HTMLElement>(BAND) ?? [])].flatMap((el) =>
      el.dataset.bandId === undefined ? [] : [[el.dataset.bandId, el] as const]
    )
  );

const topIn = (root: Element, el: Element) =>
  el.getBoundingClientRect().top - root.getBoundingClientRect().top;

// KAN-822 (KAN-959). `heldRoom`: the window whose room held open the drop closes, and this list's rows.
export function landingTops(
  root: Element | null,
  row: Element | undefined,
  heldRoom?: { windowId: string; rows: ReadonlyMap<string, Element> }
): LandingTops {
  const blocks = new Map<string, number>();
  if (root === null) return { blocks, row: null, heldRoom: null };
  root.querySelectorAll<HTMLElement>(BLOCK).forEach((el) => {
    const id = el.dataset.dropWindowId;
    if (id !== undefined) blocks.set(id, topIn(root, el));
  });
  const block =
    heldRoom === undefined ? undefined : blockOf(root, heldRoom.windowId);
  return {
    blocks,
    row: row === undefined ? null : topIn(root, row),
    heldRoom:
      heldRoom === undefined || block === undefined
        ? null
        : {
            windowId: heldRoom.windowId,
            bands: new Map(
              [...bandsIn(block)].map(([id, el]) => [id, topIn(root, el)])
            ),
            rows: new Map(
              [...heldRoom.rows].flatMap(([id, el]) =>
                el !== row && block.contains(el)
                  ? [[id, topIn(root, el)] as const]
                  : []
              )
            ),
          },
  };
}

// In the commit that drew the move, before it paints. With Reduce motion on, nothing glides.
// KAN-822. A dropped row in a window glides from where it was let go, within its window too; the rows that made room stay put (KAN-835).
// KAN-822 (KAN-959). A room held open closing: its window's bands and rows (`rows`, this list's) glide up too, and everything eases out.
export function slideLanding(
  root: Element | null,
  before: LandingTops,
  row: HTMLElement | undefined,
  rows: ReadonlyMap<string, Element> = new Map()
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
  const closing = heldRoomGlides(root, before.heldRoom, row, rows);
  const block = row?.closest(BLOCK) ?? null;
  // KAN-957. A session row keeps main's snap: gliding one flickered the list 11px for a frame, cause untraced.
  if (moved.size === 0 && block === null && closing.size === 0) return;
  const blockBy = block === null ? undefined : moved.get(block);
  const band = row?.closest(BAND) ?? null;
  const bandBy = band === null ? 0 : (closing.get(band) ?? 0);
  const rowBy =
    row === undefined || before.row === null
      ? 0
      : before.row - topIn(root, row) - (blockBy ?? 0) - bandBy;
  const blockEasing = before.heldRoom === null ? BLOCK_EASING : EASE.OUT;
  moved.forEach((by, el) => glide(el, by, blockEasing));
  closing.forEach((by, el) => glide(el, by, EASE.OUT));
  // KAN-822. Ease-out to settle into its slot; in a gliding block, the block's easing, so the two add up without a wobble.
  if (row !== undefined && Math.abs(rowBy) >= 1)
    glide(row, rowBy, blockBy === undefined ? EASE.OUT : blockEasing);
}

// KAN-822 (KAN-959). Each band's and row's glide in a held room's window, all read first: a row by what its band does not carry.
function heldRoomGlides(
  root: Element,
  before: HeldRoomTops | null,
  row: HTMLElement | undefined,
  rows: ReadonlyMap<string, Element>
): Map<Element, number> {
  const glides = new Map<Element, number>();
  if (before === null) return glides;
  const bands = new Map<Element, number>();
  bandsIn(blockOf(root, before.windowId)).forEach((el, id) => {
    const was = before.bands.get(id);
    if (was !== undefined) bands.set(el, was - topIn(root, el));
  });
  const rowsBy = new Map<Element, number>();
  before.rows.forEach((was, id) => {
    const el = rows.get(id);
    if (el === undefined || el === row || !root.contains(el)) return;
    const band = el.closest(BAND);
    rowsBy.set(
      el,
      was - topIn(root, el) - ((band === null ? 0 : bands.get(band)) ?? 0)
    );
  });
  [...bands, ...rowsBy].forEach(([el, by]) => {
    if (Math.abs(by) >= 1) glides.set(el, by);
  });
  return glides;
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

// KAN-822. Scrolls `row` into view at its place: its landing glides (and its block's) jump to their end for the read, then resume.
export function followIntoView(row: HTMLElement): void {
  const glides: Animation[] = [];
  for (let el: Element | null = row; el !== null; el = el.parentElement) {
    if (typeof el.getAnimations !== 'function') continue;
    glides.push(...el.getAnimations().filter((a) => a.id === LANDING_SLIDE));
  }
  const resume = glides.map((a) => {
    const was = a.currentTime;
    a.pause();
    a.currentTime = a.effect?.getComputedTiming().endTime ?? was;
    return () => {
      a.currentTime = was;
      a.play();
    };
  });
  row.scrollIntoView({ block: 'nearest' });
  resume.forEach((play) => play());
}
