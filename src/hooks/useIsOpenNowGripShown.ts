import { useSelector } from 'react-redux';

import { useMediaQuery } from './useMediaQuery';
import { useViewportWidth } from './useViewportWidth';
import { isTabView } from '../utils/functions/viewMode';
import { selectIsSavedSessionFolded } from '../redux/savedSessionFold';
import { OPEN_NOW_RAIL_QUERY } from '../components/home/opennow/railQuery';
import { isOpenNowResizable } from '../components/home/paneWidths';

// KAN-321 O1a. Only side by side is there a line between the saved session
// and Open now to drag, and only where the window leaves both panes their
// 480px is there a range to drag it through (above 1316px). MainContainer
// draws the grip by this; the tour's step 2 offers the drag by it (KAN-500).
export function useIsOpenNowGripShown(): boolean {
  const folded = useSelector(selectIsSavedSessionFolded);
  const isNarrow = useMediaQuery(OPEN_NOW_RAIL_QUERY);
  const viewportWidth = useViewportWidth();
  return (
    isTabView() && !folded && !isNarrow && isOpenNowResizable(viewportWidth)
  );
}
