import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { SyncStatus } from '../../redux/slices/globalStateSlice';
import { BOOT_SYNC_LIMIT_MS, HOLD_MS, UNPRESSED_DELAY_MS } from './syncMotion';

// performance.now() of the last press of the sync button, -Infinity if never.
// One ref for the toolbar button and the Settings card, so both show the same.
export const syncPressedAt = { current: -Infinity };

interface Options {
  awaitsBootSync: boolean;
  // performance.now() clock, like syncPressedAt.
  pressedAt: { current: number };
}

// KAN-750. 'loading' while syncing is SHOWN, else the real status. An
// unpressed sync shows after UNPRESSED_DELAY_MS, a pressed one at once; once
// shown it stays HOLD_MS. The boot sync (sign-in pending) shows, but only until
// BOOT_SYNC_LIMIT_MS after page open; a real 'loading' still shows after that.
// A press counts if it came after the last time this hook saw busy end.
export function useShownSyncStatus(
  raw: SyncStatus,
  { awaitsBootSync, pressedAt }: Options
): SyncStatus {
  const [isBootLimitHit, setIsBootLimitHit] = useState(
    () => performance.now() >= BOOT_SYNC_LIMIT_MS
  );
  const [isShown, setIsShown] = useState(false);
  const shownAt = useRef(0);
  const isShownRef = useRef(false);
  const wasBusy = useRef(false);
  const busyEndedAt = useRef(performance.now());
  // At most one pending: the delay before showing, or the hold before hiding.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What to draw while a loading is not yet shown.
  const [calm, setCalm] = useState<SyncStatus>(
    raw === 'loading' ? 'idle' : raw
  );
  if (raw !== 'loading' && raw !== calm) setCalm(raw);

  const isBusy = raw === 'loading' || (awaitsBootSync && !isBootLimitHit);

  useEffect(() => {
    if (isBootLimitHit) return;
    const id = setTimeout(
      () => setIsBootLimitHit(true),
      Math.max(0, BOOT_SYNC_LIMIT_MS - performance.now())
    );
    return () => clearTimeout(id);
  }, [isBootLimitHit]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Every render: a press does not change props, but the click's dispatch does.
  useLayoutEffect(() => {
    const setShown = (next: boolean) => {
      isShownRef.current = next;
      if (next) shownAt.current = performance.now();
      setIsShown(next);
    };
    if (isBusy !== wasBusy.current) {
      wasBusy.current = isBusy;
      clearTimeout(timer.current);
      if (isBusy) {
        if (!isShownRef.current) {
          timer.current = setTimeout(() => setShown(true), UNPRESSED_DELAY_MS);
        }
      } else {
        busyEndedAt.current = performance.now();
        if (isShownRef.current) {
          const left = HOLD_MS - (performance.now() - shownAt.current);
          if (left > 0) timer.current = setTimeout(() => setShown(false), left);
          else setShown(false);
        }
      }
    }
    if (
      isBusy &&
      !isShownRef.current &&
      pressedAt.current > busyEndedAt.current
    ) {
      clearTimeout(timer.current);
      setShown(true);
    }
  });

  return isShown ? 'loading' : calm;
}
