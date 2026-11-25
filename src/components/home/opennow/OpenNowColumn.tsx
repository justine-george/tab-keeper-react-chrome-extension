import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { useOpenNowPlace } from '../../../hooks/useOpenNowPlace';
import { useOpenWindows } from '../../../hooks/useOpenWindows';
import { endSavedSessionPeek } from '../../../redux/slices/globalStateSlice';
import { selectHasSavedSessions } from '../../../redux/savedSessionFold';
import { setFoldSavedSessionInTabView } from '../../../redux/slices/settingsDataStateSlice';
import { AppDispatch, RootState } from '../../../redux/store';
import { FOLD_ICON } from './foldIcon';
import { runPaneMotion } from '../paneMotion';
import { handFoldFocusTo, takeFoldFocus } from '../foldFocus';
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
function OpenNowColumn({ folded }: OpenNowColumnProps) {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );
  const windows = useOpenWindows(hasTabGroupsPermission);
  const isNarrow = useMediaQuery(OPEN_NOW_RAIL_QUERY);
  // O2. Side by side below 1100px the column is a rail, and at any width
  // once the saved session's button folds it (KAN-808). Folded, Open now has
  // the detail column's width, so it is the pane at any width.
  const showRail = useOpenNowPlace() === 'rail';

  // KAN-330 O14. The search text lives here, above the rail <-> pane swap,
  // so a resize across 1100px or a drawer close keeps it. Never stored.
  const [searchText, setSearchText] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const railButtonRef = useRef<HTMLButtonElement>(null);
  // Narrow, every fold or unfold swaps the rail and the pane, so the button
  // just pressed unmounts and focus would fall to <body>. The press sets
  // this; once the swap has mounted, focus goes to what took its place: the
  // pane's heading, or the rail's button. Wide, a fold from the rail's drawer
  // swaps too (KAN-808); otherwise nothing is swapped and the pressed button
  // keeps focus.
  const focusAfterSwap = useRef(false);
  useEffect(() => {
    if (!focusAfterSwap.current) return;
    focusAfterSwap.current = false;
    (showRail ? railButtonRef.current : headingRef.current)?.focus();
  }, [showRail]);

  // KAN-999. Shown by the saved session's card, which then went: focus comes
  // to the button that folds it again, or to the rail that holds that button.
  useEffect(() => {
    if (folded || !takeFoldFocus('openNowFold')) return;
    if (showRail) {
      railButtonRef.current?.focus();
      return;
    }
    headingRef.current
      ?.closest('[data-open-now-header]')
      ?.querySelector<HTMLElement>('[data-tour-anchor="fold"]')
      ?.focus();
  }, [folded, showRail]);

  // KAN-306, KAN-928. A resize or another page swapped the rail or pane away with focus inside it.
  const handOnFocus = useCallback(() => {
    focusAfterSwap.current = true;
  }, []);

  // KAN-999. Folding leaves this button nowhere. From the drawer, the pane
  // takes the drawer's place and its heading takes focus (focusAfterSwap);
  // otherwise the saved session's card does, or, with no session to show,
  // the heading.
  const hasSavedSessions = useSelector(selectHasSavedSessions);
  const fold = () => {
    focusAfterSwap.current = isNarrow || showRail;
    if (!focusAfterSwap.current) {
      if (hasSavedSessions) handFoldFocusTo('savedCard');
      else headingRef.current?.focus();
    }
    runPaneMotion(
      () => {
        dispatch(setFoldSavedSessionInTabView(true));
        dispatch(endSavedSessionPeek());
      },
      'saved',
      'fold'
    );
  };

  // Folded, the saved session's card shows it again (KAN-999), so the
  // header has no fold button then.
  const foldAction: OpenNowHeaderAction = {
    icon: FOLD_ICON.unfolded,
    label: t('Fold the saved session away'),
    onClick: fold,
    tourAnchor: 'fold',
  };

  // The windows are read here, above the swap, so a resize does not re-read.
  if (showRail) {
    return (
      <OpenNowRail
        windows={windows}
        foldAction={foldAction}
        buttonRef={railButtonRef}
        onGoneWithFocus={handOnFocus}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        searchInputRef={searchInputRef}
      />
    );
  }
  return (
    <OpenNowPane
      windows={windows}
      titleActions={folded ? [] : [foldAction]}
      headingId={headingId}
      headingRef={headingRef}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchInputRef={searchInputRef}
      onGoneWithFocus={handOnFocus}
    />
  );
}

// Memoised (KAN-321 O1a): MainContainer re-renders on every pointermove of
// an Open now resize, and this pane has nothing to redraw for it.
export default memo(OpenNowColumn);
