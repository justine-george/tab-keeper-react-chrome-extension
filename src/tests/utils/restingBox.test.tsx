import { afterEach, describe, expect, test, vi } from 'vitest';

import { restingBox } from '../../components/home/opennow/drawerCarry';

// KAN-820 F1. Where the drawer rests. `.tsx` for jsdom's DOMRect and window,
// as viewMode.test.tsx: drawerCarry.test.ts runs in node, which has neither.

afterEach(() => vi.restoreAllMocks());

describe('restingBox', () => {
  // A fixed element's offsets are already the viewport's (Chrome, measured): a scrolled document moves nothing.
  test('is its offset box, the document scrolled or not', () => {
    const el = document.createElement('div');
    for (const [key, value] of [
      ['offsetLeft', 644],
      ['offsetTop', 20],
      ['offsetWidth', 380],
      ['offsetHeight', 780],
    ] as const) {
      Object.defineProperty(el, key, { configurable: true, value });
    }
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(30);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(50);

    const box = restingBox(el);

    expect([box.left, box.top, box.width, box.height]).toEqual([
      644, 20, 380, 780,
    ]);
  });
});
