import { useEffect, useState } from 'react';

import { isTabKeeperPage } from '../utils/functions/capture';
import { isTabView } from '../utils/functions/viewMode';

// Whether Add current tab is offered: never in the tab view (KAN-279 D13), and
// not over a Tab Keeper page, which the add refuses (KAN-823, KAN-299). Asked
// once: the popup closes when focus moves, so its current tab cannot change.
// Offered until answered, so an ordinary page draws no icon popping in.
export function useCanAddCurrentTab(): boolean {
  const [overTabKeeper, setOverTabKeeper] = useState(false);
  useEffect(() => {
    if (isTabView()) return;
    let mounted = true;
    void chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => {
        if (mounted)
          setOverTabKeeper(tab !== undefined && isTabKeeperPage(tab));
      })
      // Unanswered, it stays offered; the handler asks again and decides.
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  return !isTabView() && !overTabKeeper;
}
