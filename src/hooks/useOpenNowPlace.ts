import { useSelector } from 'react-redux';

import { useMediaQuery } from './useMediaQuery';
import {
  selectIsOpenNowFolded,
  selectIsSavedSessionFolded,
} from '../redux/savedSessionFold';
import { OPEN_NOW_RAIL_QUERY } from '../components/home/opennow/railQuery';
import type { OpenNowPlace } from '../components/home/paneWidths';

// KAN-808. Where the tab view puts Open now: in the saved session's column
// when the saved session is folded, else on its rail when the window is
// narrow (KAN-280 O2) or the saved session's button folded it, else beside.
// The grid, both grips, Open now's column and the tour read this one answer.
export function useOpenNowPlace(): OpenNowPlace {
  const savedFolded = useSelector(selectIsSavedSessionFolded);
  const openNowFolded = useSelector(selectIsOpenNowFolded);
  const isNarrow = useMediaQuery(OPEN_NOW_RAIL_QUERY);
  if (savedFolded) return 'detail';
  return isNarrow || openNowFolded ? 'rail' : 'beside';
}
