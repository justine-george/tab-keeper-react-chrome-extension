import { useEffect, useId, useRef } from 'react';

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
  // O2. Side by side below 1100px the column is a rail. Folded, Open now
  // has the detail column's width, so it is the pane at any width.
  const showRail = isNarrow && !folded;

  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const railButtonRef = useRef<HTMLButtonElement>(null);
  // Narrow, every fold or unfold swaps the rail and the pane, so the button
  // just pressed unmounts and focus would fall to <body>. The press sets
  // this; once the swap has mounted, focus goes to what took its place: the
  // pane's heading, or the rail's button. Wide, nothing is swapped and the
  // pressed button keeps focus.
  const focusAfterSwap = useRef(false);
  useEffect(() => {
    if (!focusAfterSwap.current) return;
    focusAfterSwap.current = false;
    (showRail ? railButtonRef.current : headingRef.current)?.focus();
  }, [showRail]);

  const setFolded = (fold: boolean) => {
    focusAfterSwap.current = isNarrow;
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

  // The windows are read here, above the swap, so a resize does not re-read.
  if (showRail) {
    return (
      <OpenNowRail
        windows={windows}
        foldAction={foldAction}
        buttonRef={railButtonRef}
      />
    );
  }
  return (
    <OpenNowPane
      windows={windows}
      actions={[foldAction]}
      headingId={headingId}
      headingRef={headingRef}
    />
  );
}
