import { selectIsSavedSessionFolded } from './savedSessionFold';
import type { RootState } from './store';
import { isTabView } from '../utils/functions/viewMode';

// KAN-280 Part F (P5). The session the detail shows: the selected one, unless the tab view has it folded away (O4).
export const isSessionOnScreen = (
  state: RootState,
  tabGroupId: string
): boolean =>
  state.tabContainerDataState.selectedTabGroupId === tabGroupId &&
  !(isTabView() && selectIsSavedSessionFolded(state));
