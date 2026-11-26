import {
  sameCorners,
  type BelowAt,
  type CoachSide,
  type HoleCorners,
} from './coachMarkPlacement';
import { RADIUS } from '../../styles/scale';
import {
  findAndFitBox,
  panelsBox,
  rowFillBox,
  rowsBox,
  visibleRowFill,
  type AnchorBox,
  type Opening,
} from './anchorBox';
import type {
  RunSaveCard,
  RunStepKind,
  RunView,
} from '../../utils/functions/firstRun';

// Each card's anchor, box, side and liveness; sides as the approved mocks place them (A2).

export interface RunStepPlan {
  anchors: readonly string[];
  boxOf?: AnchorBox;
  // KAN-900. Elements lit and reachable in holes of their own, outside the ring.
  openings?: readonly Opening[];
  // KAN-901. The corners of what the step lights, when not a CONTROL's.
  holeCorners?: HoleCorners;
  // 'pane': the popup's left pane, the notch pointing right.
  sides: readonly CoachSide[] | 'pane';
  // KAN-1020. Below, hung from the anchor's end rather than its start.
  belowAt?: BelowAt;
  // KAN-1021. The element the card stays inside across, clear of what the step lights beside it.
  within?: string;
  // KAN-1021. A card narrower than the view's, to fit inside `within`.
  cardWidth?: string;
  isLive: boolean;
}

// CSS lengths.
// KAN-654: the full view's a size up, as the review card's is.
export const CARD_WIDTH = { popup: '290px', full: '360px' } as const;
// Step 9's Back and Pin this tab on one row, Not now under them, in rem so it grows with the text (KAN-457, KAN-654).
export const PIN_CARD_WIDTH = '25rem';
// KAN-1021. Fits the saved list at its narrowest: 356px less its 8px margins.
export const LIST_CARD_WIDTH = '320px';

const OPEN_NOW = '[data-pane="open-now"]';
const DETAIL = '[data-pane="detail"]';
const SESSIONS_PANE = '[data-pane="sessions"]';
export const SAVE = '[data-pane="sessions"] [data-tour-anchor="save"]';
const SESSIONS = '[data-pane="sessions"] [data-tour-anchor="sessions"]';
const WINDOWS = '[data-pane="detail"] [data-tour-anchor="windows"]';
const EXPAND = '[data-tour-anchor="expand"]';
const COMPACT = '[data-tour-anchor="compact"]';
// KAN-582. Delete is only in the shown session's header menu.
const SESSION_MENU = '[data-pane="detail"] [data-tour-anchor="session-menu"]';
const px = (radius: string): number => Number.parseFloat(radius);
// The save row: the name field (CONTROL) left, the save group (PANEL) right.
const SAVE_CORNERS: HoleCorners = [
  px(RADIUS.CONTROL),
  px(RADIUS.PANEL),
  px(RADIUS.PANEL),
  px(RADIUS.CONTROL),
];
const BELOW: readonly CoachSide[] = ['below', 'right', 'left'];
const LEFT_OF: readonly CoachSide[] = ['left', 'below', 'right'];
const RIGHT_OF: readonly CoachSide[] = ['right', 'below', 'left'];
// KAN-1021. A pane's panels, lit beside the ring in their own corners.
const panels = (selector: string): Opening => ({
  selector,
  boxOf: panelsBox,
  corners: sameCorners(px(RADIUS.PANEL)),
});

const row = (id: string): string =>
  `[data-pane="sessions"] [data-drag-row-id="${CSS.escape(id)}"]`;
// Every row draws these buttons; only the run's engaged row shows them.
export const rowButton = (
  id: string,
  kind: 'open' | 'switch' | 'replace'
): string => `${row(id)} [data-run-engaged] [data-tour-anchor="row-${kind}"]`;

export function runStepPlan(
  view: RunView,
  kind: RunStepKind,
  saveCard: RunSaveCard | null,
  sessionId: string | null,
  // KAN-623. Whether the full view draws ⤡ for the compact-view card to point at.
  hasCompactButton: boolean,
  // KAN-999. The selected session, while it is folded behind the Saved
  // session card; null while no card is drawn.
  foldedSessionId: string | null,
  // KAN-500. Currently open is the rail: one card, no search row or edge.
  isRail = false
): RunStepPlan | null {
  switch (kind) {
    case 'hello':
    case 'welcome':
      return null;
    // KAN-623. With no ⤡ drawn, the card sits where step 9's does.
    case 'compactView':
      return {
        anchors: hasCompactButton ? [COMPACT] : [],
        sides: BELOW,
        isLive: false,
      };
    case 'openNow':
      return {
        anchors: [OPEN_NOW],
        // O1. Its panels, not the column: that runs to the window's edges.
        boxOf: panelsBox,
        holeCorners: sameCorners(px(RADIUS.PANEL)),
        sides: LEFT_OF,
        isLive: false,
      };
    case 'findAndFit':
      // The rail draws no search row: its card, as at step 1 (O1).
      if (isRail) {
        return {
          anchors: [OPEN_NOW],
          boxOf: panelsBox,
          holeCorners: sameCorners(px(RADIUS.PANEL)),
          sides: LEFT_OF,
          isLive: true,
        };
      }
      return {
        anchors: [`${OPEN_NOW} [data-open-now-search]`, OPEN_NOW],
        boxOf: findAndFitBox,
        // KAN-900. The edge the card says to drag: lit, and reachable, outside the ring.
        // KAN-999. Folded, the card and the row it names too, and the step
        // below the search row: left of it, it covered them.
        openings: [
          // O1. Too thin to ring: the edge is only lit.
          { selector: '[data-resize-grip]', isRinged: false },
          ...(foldedSessionId === null
            ? []
            : [
                {
                  selector: '[data-saved-session-card]',
                  corners: sameCorners(px(RADIUS.PANEL)),
                },
                { selector: row(foldedSessionId), boxOf: visibleRowFill },
              ]),
        ],
        sides: foldedSessionId === null ? LEFT_OF : BELOW,
        // KAN-1020. Typing lists matches from the left under the search
        // row: below, the card hangs from the row's right end.
        belowAt: 'end',
        isLive: true,
      };
    case 'save':
      return saveCard === 'sessions'
        ? {
            anchors: [SESSIONS],
            holeCorners: sameCorners(px(RADIUS.PANEL)),
            sides: RIGHT_OF,
            isLive: false,
          }
        : {
            anchors: [SAVE],
            holeCorners: SAVE_CORNERS,
            sides: RIGHT_OF,
            isLive: true,
          };
    case 'row':
      return sessionId === null
        ? null
        : {
            anchors: [row(sessionId)],
            // KAN-901. The fill, not the row: it sits in from the row's sides.
            boxOf: rowFillBox,
            // KAN-1021. The card says the session shows on the right: that pane too.
            openings: [panels(DETAIL)],
            sides: BELOW,
            within: SESSIONS_PANE,
            ...(view === 'full' ? { cardWidth: LIST_CARD_WIDTH } : {}),
            isLive: false,
          };
    case 'open':
    case 'switch':
    case 'replace':
      return sessionId === null
        ? null
        : {
            anchors: [rowButton(sessionId, kind)],
            sides: BELOW,
            isLive: false,
          };
    case 'delete':
      return { anchors: [SESSION_MENU], sides: BELOW, isLive: false };
    case 'windows':
      return {
        anchors: [WINDOWS],
        boxOf: rowsBox,
        sides: view === 'full' ? LEFT_OF : 'pane',
        isLive: true,
      };
    // KAN-1023. The full view's drag between the two: the session's windows
    // ringed, Currently open lit beside them, both live to try a drag each
    // way (round 2); windows stay put (TabGroupDetailsContainer, OpenNowPane).
    // The card sits over the saved list.
    case 'drag':
      return {
        anchors: [WINDOWS],
        boxOf: rowsBox,
        openings: [panels(OPEN_NOW)],
        sides: LEFT_OF,
        within: SESSIONS_PANE,
        cardWidth: LIST_CARD_WIDTH,
        isLive: true,
      };
    case 'twoViews':
      return { anchors: [], sides: BELOW, isLive: false };
    case 'fullView':
      return { anchors: [EXPAND], sides: BELOW, isLive: true };
  }
}
