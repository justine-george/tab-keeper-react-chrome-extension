import { useMediaQuery } from './useMediaQuery';
import { useOpenNowPlace } from './useOpenNowPlace';
import { useViewportWidth } from './useViewportWidth';
import { isTabView } from '../utils/functions/viewMode';
import { OPEN_NOW_RAIL_QUERY } from '../components/home/opennow/railQuery';
import { isListResizable } from '../components/home/paneWidths';

// KAN-687. The list's grip shows in the tab view where the window leaves
// the list a range: folded, side by side (KAN-868) or beside Open now's
// folded rail (KAN-808), from 1100px. Below 1100px is the rail's
// query, read as Open now's grip reads it, so the two grips go together.
export function useIsListGripShown(): boolean {
  const place = useOpenNowPlace();
  const isNarrow = useMediaQuery(OPEN_NOW_RAIL_QUERY);
  const viewportWidth = useViewportWidth();
  return isTabView() && !isNarrow && isListResizable(viewportWidth, place);
}
