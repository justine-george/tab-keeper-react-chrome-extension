import type { TourStep } from '../../utils/functions/sampleTour';
import type { CoachSide } from './coachMarkPlacement';
import { ownBox, rowsBox, type AnchorBox } from './anchorBox';

// KAN-413. Each step's anchor in the pane drawing the sample; the first one drawn wins.
const IN_DETAIL = '[data-pane="detail"]';
export const TOUR_ANCHORS: Record<TourStep, readonly string[]> = {
  1: [`${IN_DETAIL} [data-tour-anchor="windows"]`],
  2: [`${IN_DETAIL} [data-tour-anchor="open"]`],
  3: [`${IN_DETAIL} [data-tour-anchor="title"]`],
  4: [
    `${IN_DETAIL} [data-tour-anchor="windows"] [data-window-tabs] [data-drag-row-id]`,
  ],
  // The menu's Delete session, or its ⋮ while the menu is closed.
  5: [
    `${IN_DETAIL} [data-tour-anchor="session-menu"] [data-menu-item="delete"]`,
    `${IN_DETAIL} [data-tour-anchor="session-menu"]`,
  ],
};

// Step 1 rings the drawn window rows; every other step its own element.
export const TOUR_BOX: Record<TourStep, AnchorBox> = {
  1: rowsBox,
  2: ownBox,
  3: ownBox,
  4: ownBox,
  5: ownBox,
};

// Full view, as mocked: beside steps 1 and 5, below steps 2 to 4; the first that fits.
export const TOUR_SIDES: Record<TourStep, readonly CoachSide[]> = {
  1: ['right', 'left', 'below'],
  2: ['below', 'right', 'left'],
  3: ['below', 'right', 'left'],
  4: ['below', 'right', 'left'],
  5: ['right', 'left', 'below'],
};

export const COACH_WIDTH = { popup: 290, full: 300 } as const;
