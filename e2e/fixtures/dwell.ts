import type { Page } from '@playwright/test';

// Pauses the dwelling row's sweep at `ms`: a session row's timer still runs (holdTimers stops it); a window title's open waits.
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

// Stops the page's timers, so a session row's spring-open waits; call it before the row becomes the target.
// Ahead of now, since the page's clock may already read later than this process's.
export const holdTimers = (page: Page) => page.clock.pauseAt(Date.now() + 200);
