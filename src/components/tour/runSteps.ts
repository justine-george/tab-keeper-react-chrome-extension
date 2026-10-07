import type { CoachSide } from './coachMarkPlacement';
import { findAndFitBox, rowsBox, type AnchorBox } from './anchorBox';
import type {
  RunSaveCard,
  RunStepKind,
  RunView,
} from '../../utils/functions/firstRun';

// Each card's anchor, box, side and liveness; sides as the approved mocks place them (A2).

export interface RunStepPlan {
  anchors: readonly string[];
  boxOf?: AnchorBox;
  // 'pane': the popup's left pane, the notch pointing right.
  sides: readonly CoachSide[] | 'pane';
  isLive: boolean;
}

export const CARD_WIDTH = { popup: 290, full: 300 } as const;
// Step 8's three actions on one row (KAN-457).
export const PIN_CARD_WIDTH = 400;

const OPEN_NOW = '[data-pane="open-now"]';
const SAVE = '[data-pane="sessions"] [data-tour-anchor="save"]';
const SESSIONS = '[data-pane="sessions"] [data-tour-anchor="sessions"]';
const WINDOWS = '[data-pane="detail"] [data-tour-anchor="windows"]';
const EXPAND = '[data-tour-anchor="expand"]';
const BELOW: readonly CoachSide[] = ['below', 'right', 'left'];
const LEFT_OF: readonly CoachSide[] = ['left', 'below', 'right'];
const RIGHT_OF: readonly CoachSide[] = ['right', 'below', 'left'];

const row = (id: string): string =>
  `[data-pane="sessions"] [data-drag-row-id="${CSS.escape(id)}"]`;
// Every row draws these buttons; only the run's engaged row shows them.
const rowButton = (id: string, kind: 'open' | 'switch' | 'delete'): string =>
  `${row(id)} [data-run-engaged] [data-tour-anchor="row-${kind}"]`;

export function runStepPlan(
  view: RunView,
  kind: RunStepKind,
  saveCard: RunSaveCard | null,
  sessionId: string | null
): RunStepPlan | null {
  switch (kind) {
    case 'hello':
    case 'welcome':
      return null;
    case 'openNow':
      return { anchors: [OPEN_NOW], sides: LEFT_OF, isLive: false };
    case 'findAndFit':
      // The narrow rail draws no search row: the rail itself, as at step 1.
      return {
        anchors: [`${OPEN_NOW} [data-open-now-search]`, OPEN_NOW],
        boxOf: findAndFitBox,
        sides: LEFT_OF,
        isLive: true,
      };
    case 'save':
      return saveCard === 'sessions'
        ? { anchors: [SESSIONS], sides: RIGHT_OF, isLive: false }
        : { anchors: [SAVE], sides: RIGHT_OF, isLive: true };
    case 'row':
      return sessionId === null
        ? null
        : { anchors: [row(sessionId)], sides: BELOW, isLive: false };
    case 'open':
    case 'switch':
    case 'delete':
      return sessionId === null
        ? null
        : {
            anchors: [rowButton(sessionId, kind)],
            sides: BELOW,
            isLive: false,
          };
    case 'windows':
      return {
        anchors: [WINDOWS],
        boxOf: rowsBox,
        sides: view === 'full' ? LEFT_OF : 'pane',
        isLive: true,
      };
    case 'twoViews':
      return { anchors: [], sides: BELOW, isLive: false };
    case 'fullView':
      return { anchors: [EXPAND], sides: BELOW, isLive: true };
  }
}
