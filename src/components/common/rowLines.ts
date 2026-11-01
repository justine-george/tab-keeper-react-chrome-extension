// KAN-721 (C2). A line touching a filled row hides; its box stays, so
// nothing moves. Rows write these beside their own fill states, so the
// line and the fill read one condition (KAN-92).
export const LINE_HIDDEN = 'border-bottom-color: transparent;';

/**
 * While `state` (a selector on the row, with &) holds, the line after the
 * row and the line before it hide. `before` is how the line before is
 * reached from the row: a list whose rows sit in wrappers with their line
 * inside reaches the previous wrapper's.
 */
export function linesBeside(
  states: readonly string[],
  before: (state: string) => string
): string {
  // One rule per selector: in a comma list, Emotion leaves an & that sits
  // inside :has() unresolved, and the rule matches nothing.
  return states
    .flatMap((state) => [`${state} + [data-row-divider]`, before(state)])
    .map((selector) => `${selector} { ${LINE_HIDDEN} }`)
    .join('\n');
}

/** The line before a row, when each row sits in a [data-drag-row-id] wrapper with its line. */
export const lineBeforeWrapped = (state: string): string =>
  `[data-drag-row-id]:has(+ [data-drag-row-id] > ${state}) > [data-row-divider]`;

/** The line before a row, when rows and lines are siblings. */
export const lineBeforeSibling = (state: string): string =>
  `[data-row-divider]:has(+ ${state})`;
