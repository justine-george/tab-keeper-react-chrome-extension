// The browser drops a page's lock when the page goes away.

export interface LockApi {
  request(
    name: string,
    options: { steal: boolean },
    callback: () => Promise<void>
  ): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[] }>;
}

export type TourLockState = 'held' | 'free' | 'unknown';

// One name for every page: the newest page to show the run takes it.
export const RUN_LOCK = 'tab-keeper-first-run';

export const tourLockName = (sampleId: string): string =>
  `tab-keeper-sample-tour:${sampleId}`;

// Read on every call: a test installs its own, and the worker never calls this.
function lockApi(): LockApi | null {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return null;
  const { locks } = navigator;
  return {
    request: (name, options, callback) =>
      locks.request(name, options, callback),
    query: () => locks.query(),
  };
}

// Resolves once this page holds the lock; onLost runs if another page takes it.
export function holdTourLock(
  name: string,
  onLost: () => void = () => undefined
): Promise<() => void> {
  const locks = lockApi();
  if (locks === null) return Promise.resolve(() => undefined);
  return new Promise((granted) => {
    let isHeld = false;
    let isLetGo = false;
    locks
      .request(
        name,
        { steal: true },
        () =>
          new Promise<void>((release) => {
            isHeld = true;
            granted(() => {
              isLetGo = true;
              release();
            });
          })
      )
      .catch((error: unknown) => {
        if (isHeld) {
          if (!isLetGo) onLost();
          return;
        }
        console.warn('Could not hold the run lock:', error);
        granted(() => undefined);
      });
  });
}

// Whether a live page holds the lock; 'unknown' when this browser cannot say.
export async function tourLockState(name: string): Promise<TourLockState> {
  const locks = lockApi();
  if (locks === null) return 'unknown';
  try {
    const { held = [] } = await locks.query();
    return held.some((lock) => lock.name === name) ? 'held' : 'free';
  } catch (error) {
    console.warn('Could not ask which page shows the run:', error);
    return 'unknown';
  }
}
