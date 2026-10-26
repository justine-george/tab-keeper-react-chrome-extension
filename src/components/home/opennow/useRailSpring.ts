// KAN-820 E. Currently open's rail as a carry receiver: a saved carry resting
// on it SPRING_OPEN_MS springs the drawer out. It takes no release (a release
// there cancels), and a live carry or the tour's sample gets no target.
import { useEffect, useRef, useState, type RefObject } from 'react';

import {
  currentCarry,
  registerCarryReceiver,
  setCarryOpens,
  useCarried,
} from '../../../redux/carry';
import { sourceSessionIdOf } from '../../../redux/carriedItem';
import { useIsOpenBlockedByTour } from '../../../hooks/useIsOpenBlockedByTour';
import { SPRING_OPEN_MS } from '../../common/springOpen';
import { inRightColumn, restingBox, type DrawerOverRail } from './drawerCarry';

// KAN-820. What lies over the rail, read from the drawer's marks when asked (the pane reads the same away and settling marks): an effect's copy lags the commit.
function drawerOverNow(drawer: HTMLElement | null): DrawerOverRail {
  if (drawer === null || drawer.matches('[data-carry-away], [data-leaving]'))
    return 'none';
  return drawer.matches('[data-drawer-settling]') ? 'settling' : 'settled';
}

interface Options {
  // The rail's column; past its right edge counts too (inRightColumn).
  railRef: RefObject<HTMLElement>;
  // The drawer, whose resting box is the rail's while it slides in (KAN-820 F1).
  drawerRef: RefObject<HTMLElement>;
  drawerOver: DrawerOverRail;
  onSpring: () => void;
}

export function useRailSpring({
  railRef,
  drawerRef,
  drawerOver,
  onSpring,
}: Options): {
  isTarget: boolean;
} {
  const carried = useCarried();
  const blocked = useIsOpenBlockedByTour(
    carried === null ? undefined : (sourceSessionIdOf(carried) ?? undefined)
  );
  // Read when the receiver is asked, not when it registered.
  const latest = useRef({ blocked, onSpring });
  useEffect(() => {
    latest.current = { blocked, onSpring };
  }, [blocked, onSpring]);

  // The layer routes the carry here; it is the target only while nothing lies over the rail.
  const [owned, setOwned] = useState(false);
  const isTarget = owned && drawerOver === 'none';

  useEffect(() => {
    const rail = () => railRef.current;
    // Uncovered by a settled drawer, whatever is carried.
    const uncovered = () => drawerOverNow(drawerRef.current) !== 'settled';
    const springs = () =>
      currentCarry()?.item.source === 'saved' && !latest.current.blocked;

    const unregister = registerCarryReceiver({
      springsCurrentlyOpen: true,
      hit: (x, y) => {
        const el = rail();
        if (el === null || !uncovered() || !springs()) return false;
        // KAN-820 F1. While the drawer slides in, its resting box is the rail's: nothing under it takes the carry.
        const drawer = drawerRef.current;
        const box =
          drawer !== null && drawerOverNow(drawer) === 'settling'
            ? restingBox(drawer)
            : el.getBoundingClientRect();
        return inRightColumn(box, x, y);
      },
      measureHit: () => {
        const el = rail();
        if (el === null) return () => false;
        // Open now's own drag in the drawer stays its own.
        const held = document.querySelector('[data-drag-held]');
        if (held !== null && el.contains(held)) return () => false;
        const box = el.getBoundingClientRect();
        return (x, y) => uncovered() && inRightColumn(box, x, y);
      },
      hover: () => {
        setCarryOpens(false);
        setOwned(true);
      },
      leave: () => setOwned(false),
      take: () => false,
    });
    return unregister;
  }, [railRef, drawerRef]);

  // S1 A's shape: the timer starts with the target look, and any change clears it.
  useEffect(() => {
    if (!isTarget) return;
    const timer = setTimeout(() => latest.current.onSpring(), SPRING_OPEN_MS);
    return () => clearTimeout(timer);
  }, [isTarget]);

  return { isTarget };
}
