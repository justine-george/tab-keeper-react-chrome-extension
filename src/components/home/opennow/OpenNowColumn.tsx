import { useDispatch, useSelector } from 'react-redux';

import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { useOpenWindows } from '../../../hooks/useOpenWindows';
import { endSavedSessionPeek } from '../../../redux/slices/globalStateSlice';
import { setFoldSavedSessionInTabView } from '../../../redux/slices/settingsDataStateSlice';
import { AppDispatch, RootState } from '../../../redux/store';
import OpenNowPane from './OpenNowPane';
import type { OpenNowHeaderAction } from './OpenNowPane';
import OpenNowRail from './OpenNowRail';
import { OPEN_NOW_RAIL_QUERY } from './railQuery';

interface OpenNowColumnProps {
  // Whether the saved session is folded away, so this pane holds the detail
  // column. MainContainer decides it, since it also decides the grid.
  folded: boolean;
}

// KAN-280 O4. Open now with its live windows and the fold button. The button
// is the only thing that writes the fold setting, and either press ends a
// peek: what the user pressed is what they see.
export default function OpenNowColumn({ folded }: OpenNowColumnProps) {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );
  const windows = useOpenWindows(hasTabGroupsPermission);
  const isNarrow = useMediaQuery(OPEN_NOW_RAIL_QUERY);

  const setFolded = (fold: boolean) => {
    dispatch(setFoldSavedSessionInTabView(fold));
    dispatch(endSavedSessionPeek());
  };

  const foldAction: OpenNowHeaderAction = folded
    ? {
        icon: 'keyboard_double_arrow_right',
        label: t('Show the saved session'),
        onClick: () => setFolded(false),
      }
    : {
        icon: 'keyboard_double_arrow_left',
        label: t('Fold the saved session away'),
        onClick: () => setFolded(true),
      };

  // O2. Side by side below 1100px the column is a rail. Folded, Open now
  // has the detail column's width, so it is the pane at any width. The
  // windows are read here, above the swap, so a resize does not re-read.
  if (isNarrow && !folded) {
    return <OpenNowRail windows={windows} foldAction={foldAction} />;
  }
  return <OpenNowPane windows={windows} actions={[foldAction]} />;
}
