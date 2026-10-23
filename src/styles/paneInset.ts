/**
 * KAN-747. A pane's side padding, 8px, as two custom properties its wrapper in
 * MainContainer can zero. There are no lines between the panes: a side that
 * faces a gap drops its padding, so the neighbour's own 8px is the whole gap,
 * and every wrapper stays exactly its column.
 */
export const PANE_INSET = {
  LEFT: '--pane-inset-left',
  RIGHT: '--pane-inset-right',
} as const;

const SIDE = '8px';

/** For a pane's root: its side padding, unless its wrapper zeroed a side. */
export const paneInsetCss = `
  padding-left: var(${PANE_INSET.LEFT}, ${SIDE});
  padding-right: var(${PANE_INSET.RIGHT}, ${SIDE});
`;
