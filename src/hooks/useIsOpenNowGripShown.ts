import { useOpenNowPlace } from './useOpenNowPlace';
import { useViewportWidth } from './useViewportWidth';
import { isTabView } from '../utils/functions/viewMode';
import { isOpenNowResizable } from '../components/home/paneWidths';

// KAN-321 O1a. Only side by side is there a line between the saved session
// and Open now to drag (not folded either way, nor the narrow rail), and only
// where the window leaves both panes their 340px is there a range to drag it
// through (1100px and wider, KAN-868). MainContainer draws the grip by this; the tour's
// step 2 offers the drag by it (KAN-500).
export function useIsOpenNowGripShown(): boolean {
  const place = useOpenNowPlace();
  const viewportWidth = useViewportWidth();
  return isTabView() && place === 'beside' && isOpenNowResizable(viewportWidth);
}
