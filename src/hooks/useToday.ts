import { useMemo, useSyncExternalStore } from 'react';

import { localDayNumber, localMidnight } from '../utils/functions/calendarDay';

/**
 * How often the day is re-checked (KAN-347). Periodic rather than one timer
 * for midnight: Chrome slows a hidden tab's timers, and a timer can fire late
 * after the computer sleeps. The tab view can stay open for days.
 */
export const DAY_CHECK_MS = 60_000;

const listeners = new Set<() => void>();
let stopChecking: (() => void) | null = null;

function notify(): void {
  listeners.forEach((listener) => listener());
}

// One interval and one listener however many rows are mounted.
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (stopChecking === null) {
    const id = window.setInterval(notify, DAY_CHECK_MS);
    // Back in view: check at once rather than up to a minute later.
    document.addEventListener('visibilitychange', notify);
    stopChecking = () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', notify);
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopChecking !== null) {
      stopChecking();
      stopChecking = null;
    }
  };
}

// A number, so React compares snapshots by value: the check runs every
// minute, and only a new day re-renders.
const todayNumber = (): number => localDayNumber(new Date());

/**
 * Local midnight of today. A new value, and a re-render, only when the day
 * changes.
 */
export function useToday(): Date {
  const day = useSyncExternalStore(subscribe, todayNumber);
  return useMemo(() => localMidnight(day), [day]);
}
