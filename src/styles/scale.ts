/**
 * The app's shared scales (KAN-205).
 *
 * Every size, radius, height and duration in the popup comes from here. The
 * audit that produced these counted, from source: 15 distinct font sizes, 9
 * heights, 6 corner radii, 25 padding pairs and 3 transition durations, with
 * neighbouring areas using different values for the same job.
 *
 * Each scale below is enforced by `scaleConformance.test.ts`, which scans the
 * components for values that are not in these sets. That test is the point of
 * this file: a constant nobody is obliged to use becomes one more value in the
 * pile.
 *
 * THE EXPORT PAGE IS EXCLUDED, deliberately and for now. It is the only surface
 * mixing px and rem, it owns four of the six radii and all three font weights,
 * and it is frozen while its output is being relied on. When it is opened up,
 * the same scales apply and the conformance test's exclusion comes off.
 */

/**
 * Type scale, in rem. Five steps.
 *
 * Derived from what was already there rather than imposed: 0.9rem was the single
 * most-used size in the app, so it anchors BODY and the rest are spaced around
 * it. Anything that was within a step's reach snapped to it; the handful that
 * were not were judged per call site.
 */
export const TYPE = {
  /** Counts, timestamps, tag text. */
  META: '0.7rem',
  /** Secondary lines under a title. */
  SECONDARY: '0.8rem',
  /** Default. Rows, buttons, menu items, toasts. */
  BODY: '0.9rem',
  /** A section heading inside a pane. */
  SECTION: '1.1rem',
  /** The title of a pane. */
  TITLE: '1.25rem',
} as const;

/**
 * Corner radius. Square everywhere.
 *
 * What the codebase already believed about itself -- OverflowMenu documents
 * radius as "0px every time", which had quietly stopped being true. A circle is
 * not a radius decision, it is a shape, so avatars keep theirs.
 */
export const RADIUS = {
  SQUARE: '0px',
  /** Avatars only. Not a corner. */
  CIRCLE: '50%',
} as const;

/**
 * Control heights, built on the 32px row the lists already use.
 *
 * Multiples of that row, so controls line up with the rows beside them instead
 * of nearly doing so: buttons and inputs came down from 3.5rem (56px), which was
 * not a multiple of anything.
 */
export const CONTROL = {
  /** Rows, icon buttons, tags. */
  ROW: '32px',
  /** Buttons, text inputs. */
  DEFAULT: '48px',
  /** Pane headers. */
  HEADER: '64px',
} as const;

/**
 * Icon sizes. Two levels, because the app genuinely uses two.
 *
 * Collapsing these to one was tried and reverted: every icon at DEFAULT made
 * the save pair and the "add current window" control heavier than the jobs they
 * do, and the point of the audit was to remove sizes nobody chose -- not to
 * remove a distinction someone did.
 *
 * What the audit did settle is that there were THREE values doing these two
 * jobs (1.3rem, 1.5rem and a 28px one-off), which is how the toolbar came to
 * read as undersized next to its neighbour. Two named levels, and a third is a
 * line in this file when something needs it -- not an override at a call site.
 */
export const ICON = {
  /** Secondary or inline actions, subordinate to the control they sit in. */
  SMALL: '1.25rem',
  /** The default. Toolbar, row actions, menu items. */
  DEFAULT: '1.5rem',
} as const;

/**
 * Transition durations. Two, named for what they animate.
 *
 * The three values in use were doing two jobs: 0.1s and 0.2s were colour fades,
 * 0.18s was the drag's rows stepping aside. Naming them by the job is what stops
 * a fourth appearing next to them.
 */
export const DURATION = {
  /** Colour, opacity, fills -- anything that does not move. */
  COLOR: '120ms',
  /** Anything that changes position or size. */
  MOVE: '200ms',
} as const;
