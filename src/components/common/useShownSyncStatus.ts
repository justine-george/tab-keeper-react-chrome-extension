import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { SyncStatus } from '../../redux/slices/globalStateSlice';
import { BOOT_SYNC_LIMIT_MS, HOLD_MS, UNPRESSED_DELAY_MS } from './syncMotion';

// performance.now() of the last press of the sync button, -Infinity if never.
// One ref for the toolbar button and the Settings card, so both show the same.
export const syncPressedAt = { current: -Infinity };
// performance.now() of the last time any instance saw no sync under way: busy
// ending, or a mount while idle. Shared, so a remount mid-sync keeps a press.
export const syncBusyEndedAt = { current: -Infinity };
// performance.now() of the last time any instance began showing a sync. Shared,
// so a remount mid-sync keeps showing one already shown (R20).
export const syncShownAt = { current: -Infinity };

// KAN-750 R8b. Whether the boot sync's wait for sign-in still counts as syncing:
// until BOOT_SYNC_LIMIT_MS after page open, so every instance agrees.
export function useBootSyncWait(awaitsBootSync: boolean): boolean {
  // Seeded, so a page past the limit never counts it, not even for a render.
  const [isLimitHit, setIsLimitHit] = useState(
    () => performance.now() >= BOOT_SYNC_LIMIT_MS
  );
  useEffect(() => {
    if (isLimitHit) return;
    const id = setTimeout(
      () => setIsLimitHit(true),
      Math.max(0, BOOT_SYNC_LIMIT_MS - performance.now())
    );
    return () => clearTimeout(id);
  }, [isLimitHit]);
  return awaitsBootSync && !isLimitHit;
}

interface Options {
  // A sync is on its way while the status may not be 'loading' yet: the boot
  // wait (from useBootSyncWait) or a running Sync now.
  awaitsSync: boolean;
  // performance.now() clock, like syncPressedAt.
  pressedAt: { current: number };
}

// KAN-750. 'loading' while syncing is SHOWN, else the real status. An
// unpressed sync shows after UNPRESSED_DELAY_MS, a pressed one at once; once
// shown it stays HOLD_MS. A sync on its way (awaitsSync) is busy like 'loading'.
// A press counts if it came after the last time an instance saw no sync under way;
// so does a sync another instance, or this one before a remount, already shows.
export function useShownSyncStatus(
  raw: SyncStatus,
  { awaitsSync, pressedAt }: Options
): SyncStatus {
  const [isShown, setIsShown] = useState(false);
  const shownAt = useRef(0);
  const isShownRef = useRef(false);
  // null until this mount has looked.
  const wasBusy = useRef<boolean | null>(null);
  // At most one pending: the delay before showing, or the hold before hiding.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What to draw while a loading is not yet shown.
  const [calm, setCalm] = useState<SyncStatus>(
    raw === 'loading' ? 'idle' : raw
  );
  if (raw !== 'loading' && raw !== calm) setCalm(raw);

  const isBusy = raw === 'loading' || awaitsSync;

  // Reset too: StrictMode's rehearsal remount must schedule the delay again.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      wasBusy.current = null;
    },
    []
  );

  // Every render: a press does not change props, but the click's dispatch does.
  useLayoutEffect(() => {
    const setShown = (next: boolean) => {
      isShownRef.current = next;
      if (next) {
        shownAt.current = performance.now();
        syncShownAt.current = shownAt.current;
      }
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
        syncBusyEndedAt.current = performance.now();
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
      (pressedAt.current > syncBusyEndedAt.current ||
        syncShownAt.current > syncBusyEndedAt.current)
    ) {
      clearTimeout(timer.current);
      setShown(true);
    }
  });

  return isShown ? 'loading' : calm;
}
