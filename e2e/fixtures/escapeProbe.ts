import type { BrowserContext, Page } from '@playwright/test';

// KAN-426. Holds every Esc keydown from document start, read after dispatch; CDP keys never reach Chrome's own popup Esc.
export async function watchEscapes(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    const seen: KeyboardEvent[] = [];
    Object.defineProperty(globalThis, '__escapes', { value: seen });
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') seen.push(event);
      },
      true
    );
  });
}

// Whether each Esc so far was prevented, so the browser never saw it.
export const escapesPrevented = (page: Page): Promise<boolean[]> =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__escapes');
    if (!Array.isArray(seen)) throw new Error('no Esc watch on this page');
    return seen.map((event: unknown) =>
      event instanceof KeyboardEvent ? event.defaultPrevented : false
    );
  });
