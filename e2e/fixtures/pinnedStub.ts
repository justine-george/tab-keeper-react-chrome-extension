import type { BrowserContext } from '@playwright/test';

// Playwright makes every page visible, so a stub reports hidden until shown; the no-CDP test is real Chrome.
export async function stubsStayHidden(context: BrowserContext) {
  await context.addInitScript(() => {
    if (!location.pathname.endsWith('/pinned.html')) return;
    const hidden = () => Reflect.get(window, '__shown') !== true;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden() ? 'hidden' : 'visible'),
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: hidden,
    });
  });
}
