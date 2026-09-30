import { useSyncExternalStore } from 'react';

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

// The snapshot must be the same object until something changes, so midnight
// is cached with the day and the zone it was built for. The check runs every
// minute; only a new day or a new zone makes a new Date, and a re-render.
//
// The zone matters on its own: a traveller going from New York to Los
// Angeles on one afternoon keeps the day number, but midnight is a different
// instant there and every time shown moves.
let cached: { day: number; offset: number; midnight: Date } | null = null;

function todaySnapshot(): Date {
  const now = new Date();
  const day = localDayNumber(now);
  const offset = now.getTimezoneOffset();
  if (cached === null || cached.day !== day || cached.offset !== offset) {
    cached = { day, offset, midnight: localMidnight(day) };
  }
  return cached.midnight;
}

/**
 * Local midnight of today. A new value, and a re-render, only when the day
 * or the time zone changes.
 */
export function useToday(): Date {
  return useSyncExternalStore(subscribe, todaySnapshot);
}
