import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { useMediaQuery } from './useMediaQuery';
import type { AppDispatch, RootState } from '../redux/store';
import { followToolbarMode } from '../redux/toolbarIconChoice';

// KAN-933. Monochrome's whole reach: Chrome reports no mode change to an extension, and
// a hidden page stays on the system's setting, so a page that is open does this.
export function useToolbarIconMode(): void {
  const dispatch: AppDispatch = useDispatch();
  const isMonochrome = useSelector(
    (state: RootState) => state.settingsDataState.toolbarIcon === 'monochrome'
  );
  const isDark = useMediaQuery('(prefers-color-scheme: dark)');

  useEffect(() => {
    if (isMonochrome)
      void dispatch(followToolbarMode(isDark ? 'dark' : 'light'));
  }, [dispatch, isMonochrome, isDark]);
}
