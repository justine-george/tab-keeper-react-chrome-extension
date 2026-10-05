// Any of these before the delay ends means the user is busy; a scroll the app starts at open would count too.
export const QUIET_BREAKERS = [
  'keydown',
  'pointerdown',
  'wheel',
  'scroll',
  'dragstart',
] as const;

export type QuietOutcome = 'quiet' | 'interrupted';

// Captured on document, so a scroll inside any pane counts; passive, so nothing is prevented.
export function waitForQuiet(delayMs: number): Promise<QuietOutcome> {
  return new Promise((settle) => {
    let timer = 0;
    const done = (outcome: QuietOutcome) => {
      window.clearTimeout(timer);
      for (const type of QUIET_BREAKERS) {
        document.removeEventListener(type, interrupted, true);
      }
      settle(outcome);
    };
    const interrupted = () => done('interrupted');
    for (const type of QUIET_BREAKERS) {
      document.addEventListener(type, interrupted, {
        capture: true,
        passive: true,
      });
    }
    timer = window.setTimeout(() => done('quiet'), delayMs);
  });
}
