import { useSelector } from 'react-redux';

import { useMediaQuery } from './useMediaQuery';
import { useViewportWidth } from './useViewportWidth';
import { isTabView } from '../utils/functions/viewMode';
import { selectIsSavedSessionFolded } from '../redux/savedSessionFold';
import { OPEN_NOW_RAIL_QUERY } from '../components/home/opennow/railQuery';
import { isListResizable } from '../components/home/paneWidths';

// KAN-687. The list's grip shows in the tab view where the window leaves
// the list a range: folded above 1100px, side by side above 1316px. Below
// 1100px is the rail's query, read as Open now's grip reads it, so the two
// grips go together.
export function useIsListGripShown(): boolean {
  const folded = useSelector(selectIsSavedSessionFolded);
  const isNarrow = useMediaQuery(OPEN_NOW_RAIL_QUERY);
  const viewportWidth = useViewportWidth();
  return isTabView() && !isNarrow && isListResizable(viewportWidth, folded);
}
