// KAN-413 §3 Interrupted. The browser drops a page's lock when the page goes away.

export interface LockApi {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[] }>;
}

export type TourLockState = 'held' | 'free' | 'unknown';

export const tourLockName = (sampleId: string): string =>
  `tab-keeper-sample-tour:${sampleId}`;

// Read on every call: a test installs its own, and the worker never calls this.
function lockApi(): LockApi | null {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return null;
  const { locks } = navigator;
  return {
    request: (name, callback) => locks.request(name, callback),
    query: () => locks.query(),
  };
}

// Resolves once this page holds the lock; the function it gives back lets it go.
export function holdTourLock(sampleId: string): Promise<() => void> {
  const locks = lockApi();
  if (locks === null) return Promise.resolve(() => undefined);
  return new Promise((granted) => {
    locks
      .request(
        tourLockName(sampleId),
        () => new Promise<void>((release) => granted(() => release()))
      )
      .catch((error: unknown) => {
        console.warn('Could not hold the sample tour lock:', error);
        granted(() => undefined);
      });
  });
}

// Whether a live page holds the lock; 'unknown' when this browser cannot say.
export async function tourLockState(sampleId: string): Promise<TourLockState> {
  const locks = lockApi();
  if (locks === null) return 'unknown';
  try {
    const { held = [] } = await locks.query();
    return held.some((lock) => lock.name === tourLockName(sampleId))
      ? 'held'
      : 'free';
  } catch (error) {
    console.warn('Could not ask which page runs the sample tour:', error);
    return 'unknown';
  }
}
