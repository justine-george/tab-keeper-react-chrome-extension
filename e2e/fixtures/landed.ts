import type { Locator, Page } from '@playwright/test';

// Which animations an element's wait covers: those on it and everything inside
// it, or those on it and every element that carries it.
export type Reach = 'subtree' | 'ancestors';

// Self-contained: Playwright serialises it into the page.
async function settle(el: Element, reach: Reach | 'document') {
  const inReach = (): Animation[] => {
    if (reach === 'document') return document.getAnimations();
    if (reach === 'subtree') return el.getAnimations({ subtree: true });
    const carried: Animation[] = [];
    for (let at: Element | null = el; at !== null; at = at.parentElement) {
      carried.push(...at.getAnimations());
    }
    return carried;
  };
  const moving = () => inReach().filter((a) => a.playState !== 'finished');
  // allSettled: a cancelled animation's `finished` rejects with AbortError.
  // Then look again: whatever cancelled it may have started its replacement.
  for (let left = moving(); left.length > 0; left = moving()) {
    await Promise.allSettled(left.map((a) => a.finished));
  }
}

/** Resolves once no animation in the page is still running. */
export async function documentLanded(page: Page): Promise<void> {
  await page.locator(':root').evaluate(settle, 'document' as const);
}

/** Resolves once no animation within `reach` of `el` is still running. */
export async function elementLanded(el: Locator, reach: Reach): Promise<void> {
  await el.evaluate(settle, reach);
}
