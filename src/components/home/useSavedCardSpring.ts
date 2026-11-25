// KAN-1006 (his yes). The folded saved session's card as a carry receiver, in
// the rail's shape (useRailSpring): a live carry resting on it SPRING_OPEN_MS
// peeks the saved session (peekForCarry). It takes no release: one there
// cancels, so the card wears no +. A saved carry gets no target.
import { useEffect, useState, type RefObject } from 'react';
import { useDispatch } from 'react-redux';

import {
  currentCarry,
  registerCarryReceiver,
  setCarryOpens,
  setLiveCarrySaves,
} from '../../redux/carry';
import { peekForCarry } from '../../redux/carryPeek';
import type { AppDispatch } from '../../redux/store';
import { SPRING_OPEN_MS } from '../common/springOpen';

const inBox = (b: DOMRect, x: number, y: number) =>
  x >= b.left && x < b.right && y >= b.top && y < b.bottom;

// `slotRef`: the card's column, its gutters included, so the whole column is the target.
export function useSavedCardSpring(slotRef: RefObject<HTMLElement>): {
  isTarget: boolean;
} {
  const dispatch: AppDispatch = useDispatch();
  const [isTarget, setIsTarget] = useState(false);

  useEffect(() => {
    const live = () => currentCarry()?.item.source === 'live';
    const unregister = registerCarryReceiver({
      hit: (x, y) => {
        const el = slotRef.current;
        return el !== null && live() && inBox(el.getBoundingClientRect(), x, y);
      },
      measureHit: () => {
        const el = slotRef.current;
        if (el === null) return () => false;
        const box = el.getBoundingClientRect();
        return (x, y) => live() && inBox(box, x, y);
      },
      hover: () => {
        setLiveCarrySaves(false);
        setCarryOpens(false);
        setIsTarget(true);
      },
      leave: () => setIsTarget(false),
      take: () => false,
    });
    return () => {
      unregister();
      setIsTarget(false);
    };
  }, [slotRef]);

  // S1 A's shape: the timer starts with the target look, and any change clears it.
  useEffect(() => {
    if (!isTarget) return;
    const timer = setTimeout(() => dispatch(peekForCarry()), SPRING_OPEN_MS);
    return () => clearTimeout(timer);
  }, [isTarget, dispatch]);

  return { isTarget };
}
