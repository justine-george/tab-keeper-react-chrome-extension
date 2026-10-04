import type { Page } from '@playwright/test';

// Pauses the dwelling row's sweep at `ms`: a session row's timer still runs; a window title's open waits.
export const holdSweepAt = (page: Page, selector: string, ms: number) =>
  page.locator(selector).evaluate(
    (el, ms) => {
      const [sweep] = el.getAnimations();
      sweep.pause();
      sweep.currentTime = ms;
      const cs = getComputedStyle(el);
      return {
        color: /rgba?\([^)]*\)/.exec(cs.backgroundImage)?.[0] ?? '',
        size: cs.backgroundSize,
      };
    },
    ms,
    { timeout: 1000 }
  );
