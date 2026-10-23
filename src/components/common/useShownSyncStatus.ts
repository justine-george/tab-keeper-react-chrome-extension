import { useEffect, useRef, useState } from 'react';

import type { SyncStatus } from '../../redux/slices/globalStateSlice';
import { BOOT_SYNC_LIMIT_MS, HOLD_MS, UNPRESSED_DELAY_MS } from './syncMotion';

// A raw busy flip this soon after a press (Date.now ms) counts as the press's.
const PRESS_WINDOW_MS = 250;

interface Options {
  awaitsBootSync: boolean;
  // Date.now() of the last press of the sync button; -Infinity if never.
  pressedAt: { current: number };
}

// KAN-750. 'loading' while syncing is SHOWN, else the real status. An
// unpressed sync shows after UNPRESSED_DELAY_MS, a pressed one at once; once
// shown it stays HOLD_MS. The boot sync (sign-in pending) shows, but only for
// BOOT_SYNC_LIMIT_MS from mount; a real 'loading' still shows after that.
export function useShownSyncStatus(
  raw: SyncStatus,
  { awaitsBootSync, pressedAt }: Options
): SyncStatus {
  const [isBootLimitHit, setIsBootLimitHit] = useState(false);
  const [isShown, setIsShown] = useState(false);
  const shownAt = useRef(0);
  const isShownRef = useRef(false);
  // At most one pending: the delay before showing, or the hold before hiding.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What to draw while a loading is not yet shown.
  const [calm, setCalm] = useState<SyncStatus>(
    raw === 'loading' ? 'idle' : raw
  );
  if (raw !== 'loading' && raw !== calm) setCalm(raw);

  const isBusy = raw === 'loading' || (awaitsBootSync && !isBootLimitHit);

  useEffect(() => {
    const id = setTimeout(() => setIsBootLimitHit(true), BOOT_SYNC_LIMIT_MS);
    return () => {
      clearTimeout(id);
      clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const setShown = (next: boolean) => {
      isShownRef.current = next;
      if (next) shownAt.current = Date.now();
      setIsShown(next);
    };
    clearTimeout(timer.current);
    if (isBusy) {
      if (isShownRef.current) return;
      if (Date.now() - pressedAt.current <= PRESS_WINDOW_MS) setShown(true);
      else timer.current = setTimeout(() => setShown(true), UNPRESSED_DELAY_MS);
    } else if (isShownRef.current) {
      const left = HOLD_MS - (Date.now() - shownAt.current);
      if (left > 0) timer.current = setTimeout(() => setShown(false), left);
      else setShown(false);
    }
  }, [isBusy, pressedAt]);

  return isShown ? 'loading' : calm;
}
