import { useSyncExternalStore } from 'react';

// KAN-708. Read once per page, as every row asks: null until Chrome answers, false if it can't.
let answer: boolean | null = null;
let asked = false;
// KAN-708. Bumped by forgetPlatform, so an answer to an earlier ask is dropped.
let generation = 0;
const listeners = new Set<() => void>();

function settle(askedIn: number, isMac: boolean): void {
  if (askedIn !== generation) return;
  answer = isMac;
  for (const listener of [...listeners]) listener();
}

function ask(): void {
  if (asked) return;
  asked = true;
  const askedIn = generation;
  chrome.runtime.getPlatformInfo().then(
    (info) => settle(askedIn, info.os === 'mac'),
    (error: unknown) => {
      console.warn('Could not read the platform: ', error);
      settle(askedIn, false);
    }
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ask();
  return () => {
    listeners.delete(listener);
  };
}

// KAN-708. Tests only: each test seeds its own platform.
export function forgetPlatform(): void {
  generation += 1;
  answer = null;
  asked = false;
}

// null until Chrome says the platform; false if it can't, as most platforms are not a Mac.
export function useIsMac(): boolean | null {
  return useSyncExternalStore(subscribe, () => answer);
}

// KAN-592. For naming keys: false until Chrome says Mac, so a PC renders once and never again.
export function useMacKeys(): boolean {
  return useSyncExternalStore(subscribe, () => answer === true);
}
