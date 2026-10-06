// KAN-394 P3. A carried saved item let go on the save row becomes a new session.
// Registered at rest too (D19), so a drag that reaches the row hands off to a
// carry here (KAN-352); never while searching (KAN-385).
import { useEffect, type RefObject } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';

import type { AppDispatch } from '../../../redux/store';
import {
  currentCarry,
  registerCarryReceiver,
  type CarryReceiver,
} from '../../../redux/carry';
import { moveToNewSession } from '../../../redux/moveToNewSession';
import { useSavedSearch } from '../../../hooks/useSavedSearch';

// Returns whether the row takes a carry now, which is when it draws a target.
export function useNewSessionReceiver(
  // The save row: its box is where a carry is taken.
  row: RefObject<HTMLElement | null>,
  // The New session target drawn over it, lit while the pointer is on it.
  target: RefObject<HTMLElement | null>
): boolean {
  const dispatch: AppDispatch = useDispatch();
  const { t } = useTranslation();
  const { isSearching } = useSavedSearch();
  const takes = !isSearching;

  useEffect(() => {
    if (!takes) return;

    let lit = false;
    const light = (on: boolean) => {
      lit = on;
      if (on) target.current?.setAttribute('data-landing', '');
      else target.current?.removeAttribute('data-landing');
    };

    const measureHit = (): ((x: number, y: number) => boolean) => {
      const b = row.current?.getBoundingClientRect();
      if (b === undefined) return () => false;
      return (x, y) => x >= b.left && x < b.right && y >= b.top && y < b.bottom;
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
        const carried = currentCarry()?.carried;
        if (carried === undefined) return false;
        return dispatch(moveToNewSession(carried, t('New Tab Group')));
      },
    };

    const unregister = registerCarryReceiver(receiver);
    return () => {
      unregister();
      receiver.leave();
    };
  }, [takes, row, target, dispatch, t]);

  return takes;
}
