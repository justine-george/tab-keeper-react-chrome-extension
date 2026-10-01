// KAN-361 (N1 B). The session header's New window target takes a carry the
// layer drives: a tab or group carried from the session list straight onto
// it, never entering the list, is let go there as a new first window of the
// session on screen.
//
// A carry receiver like the session list's rows (TabGroupEntryContainer),
// and registered only while it can take what is carried: a tab or group,
// into a session that offers it a landing (landingView -- the same test that
// draws the phantom the list adopts). For a window, for no carry, for an
// ordinary drag, and while the search panel is open (KAN-140), it is not
// there at all, so nothing is ever handed to it that it would refuse.
//
// An engine drag that comes up from the list over it is never handed here:
// the engine asks its own copy of the target first (RowDragArea, Q3 i).
import { useEffect, useMemo, type RefObject } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { AppDispatch, RootState } from '../../../redux/store';
import {
  currentCarry,
  registerCarryReceiver,
  useCarried,
  type CarryReceiver,
} from '../../../redux/carry';
import { dropCarriedGroup, dropCarriedTab } from '../../../redux/dropCarried';
import { landingView } from '../../../utils/functions/carriedView';
import {
  NEW_FIRST_WINDOW,
  measureNewFirstWindowTarget,
} from './newWindowTarget';

export function useNewFirstWindowReceiver(
  // The header's target element.
  target: RefObject<HTMLElement | null>,
  // The session on screen, which the new window is made in.
  tabGroupId: string | undefined
): void {
  const dispatch: AppDispatch = useDispatch();
  const tabGroups = useSelector(
    (state: RootState) => state.tabContainerDataState.tabGroups
  );
  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );
  const carried = useCarried();

  const takes = useMemo(
    () =>
      !isSearchPanel &&
      carried !== null &&
      carried.kind !== 'window' &&
      tabGroupId !== undefined &&
      landingView(tabGroups, tabGroupId, carried) !== null,
    [isSearchPanel, carried, tabGroupId, tabGroups]
  );

  useEffect(() => {
    if (!takes || tabGroupId === undefined) return;

    // Lit by this receiver, so leave unlights only what it lit: the engine
    // lights the same target for a drag it drives (markNewWindowTarget).
    let lit = false;
    const light = (on: boolean) => {
      lit = on;
      if (on) target.current?.setAttribute('data-landing', '');
      else target.current?.removeAttribute('data-landing');
    };

    // The target as drawn now, by the rule the engine reads it by.
    const measureHit = (): ((x: number, y: number) => boolean) => {
      const el = target.current;
      return (
        (el === null ? null : measureNewFirstWindowTarget(el.ownerDocument)) ??
        (() => false)
      );
    };

    const receiver: CarryReceiver = {
      hit: (x, y) => measureHit()(x, y),
      measureHit,
      hover() {
        if (!lit) light(true);
      },
      leave() {
        if (lit) light(false);
      },
      // Commits synchronously and says whether anything moved; the layer
      // ends the carry after this either way.
      take() {
        const now = currentCarry()?.carried;
        const spot = { tabGroupId, toWindowId: NEW_FIRST_WINDOW, toIndex: 0 };
        if (now?.kind === 'tab') return dispatch(dropCarriedTab(now, spot));
        if (now?.kind === 'group') return dispatch(dropCarriedGroup(now, spot));
        return false;
      },
    };

    const unregister = registerCarryReceiver(receiver);
    return () => {
      unregister();
      receiver.leave();
    };
  }, [takes, tabGroupId, target, dispatch]);
}
