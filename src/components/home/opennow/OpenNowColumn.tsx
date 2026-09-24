import { useDispatch, useSelector } from 'react-redux';

import { useTranslation } from 'react-i18next';

import { useOpenWindows } from '../../../hooks/useOpenWindows';
import { endSavedSessionPeek } from '../../../redux/slices/globalStateSlice';
import { setFoldSavedSessionInTabView } from '../../../redux/slices/settingsDataStateSlice';
import { AppDispatch, RootState } from '../../../redux/store';
import OpenNowPane from './OpenNowPane';
import type { OpenNowHeaderAction } from './OpenNowPane';

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

  return <OpenNowPane windows={windows} actions={[foldAction]} />;
}
