import type { RootState } from './store';
import type { TabMasterContainer } from './slices/tabContainerDataStateSlice';
import { isDragHeld } from './dragHold';
import { panes, prepareLayoutGlide } from '../components/common/layoutGlide';

/**
 * KAN-991. A session that reaches this page from another open page or by
 * sync comes in as one saved here does (KAN-988): call just before the
 * dispatch that loads `incoming`. Nothing moves:
 * - on the page's first load, which draws the list rather than changes it;
 * - while a row is held, as the change then lands with the drop;
 * - when `incoming` brings no session this page lacks.
 */
export function prepareArrivalGlide(
  state: RootState,
  incoming: TabMasterContainer
): void {
  if (state.globalState.holdsPlaceholderSessions || isDragHeld()) return;
  const here = new Set(
    state.tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
  );
  if (!incoming.tabGroups.some((g) => !here.has(g.tabGroupId))) return;
  prepareLayoutGlide(panes('sessions'), 'arrive', 'elsewhere');
}
