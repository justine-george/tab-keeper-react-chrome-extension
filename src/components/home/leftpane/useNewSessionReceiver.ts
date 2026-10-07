// KAN-394 P3. A carry let go on the save row becomes a new session; not while searching or for the whole first run here (F18).
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import type { AppDispatch } from '../../../redux/store';
import {
  currentCarry,
  registerCarryReceiver,
  type CarryReceiver,
} from '../../../redux/carry';
import { moveToNewSession } from '../../../redux/moveToNewSession';
import { selectRunHere } from '../../../redux/firstRun';
import {
  closeNewSessionSlot,
  fillNewSessionSlot,
  openNewSessionSlot,
} from './newSessionSlot';
import { useSavedSearch } from '../../../hooks/useSavedSearch';

// Returns whether the row takes a carry now, which is when it draws a target.
export function useNewSessionReceiver(
  // The save row: its box is where a carry is taken.
  row: RefObject<HTMLElement | null>,
  // The New session target drawn over it, lit while the pointer is on it.
  target: RefObject<HTMLElement | null>,
  // The name field's text: a non-blank one names the new session (F19).
  typed: string,
  // Called with that text after a drop it named, to empty the field.
  consumeName: (typed: string) => void
): boolean {
  const dispatch: AppDispatch = useDispatch();
  const { t } = useTranslation();
  const { isSearching } = useSavedSearch();
  // The whole run, not its card: a spring-open hiding the card mid-carry must not draw the target.
  const isRunHere = useSelector(selectRunHere) !== null;
  const takes = !isSearching && !isRunHere;

  // Read on the release, so typing does not re-register the receiver.
  const typedRef = useRef(typed);
  useLayoutEffect(() => {
    typedRef.current = typed;
  }, [typed]);

  useEffect(() => {
    if (!takes) return;

    let lit = false;
    // Lit, the session list opens its place for the new session.
    const light = (on: boolean) => {
      lit = on;
      if (on) target.current?.setAttribute('data-landing', '');
      else target.current?.removeAttribute('data-landing');
      if (on) openNewSessionSlot();
      else closeNewSessionSlot();
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
      // Commits synchronously; the layer ends the carry either way.
      take() {
        const carried = currentCarry()?.carried;
        if (carried === undefined) return false;
        const name = typedRef.current;
        const moved = dispatch(
          moveToNewSession(carried, t('New Tab Group'), name)
        );
        if (moved) {
          consumeName(name);
          fillNewSessionSlot();
        }
        return moved;
      },
    };

    const unregister = registerCarryReceiver(receiver);
    return () => {
      unregister();
      receiver.leave();
    };
  }, [takes, row, target, dispatch, t, consumeName]);

  return takes;
}
