import { afterEach, describe, expect, test } from 'vitest';

import { openWindowNumber } from '../../utils/functions/openNow';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle } from '../setup/chrome.fake';

// KAN-1010. The number Currently open shows for a window ("Window N"): its
// place among the windows it lists, in Chrome's order (toOpenWindows).
let handle: ChromeFakeHandle | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
});

function ownPage(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

async function windowsOf(...windows: { id: number; urls: string[] }[]) {
  handle = setupChromeFake({
    windows: windows.map(({ id, urls }) => ({
      id,
      tabs: urls.map((url, i) => ({ id: id * 10 + i, url, active: i === 0 })),
    })),
  });
  return chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
}

describe('openWindowNumber', () => {
  test("a window's place in Chrome's order", async () => {
    const all = await windowsOf(
      { id: 5, urls: ['https://a.test/'] },
      { id: 9, urls: ['https://b.test/'] }
    );
    expect(openWindowNumber(all, 5)).toBe(1);
    expect(openWindowNumber(all, 9)).toBe(2);
  });

  test('a window holding only Tab Keeper is not listed, so not counted', async () => {
    const own = ownPage();
    const all = await windowsOf(
      { id: 5, urls: [own] },
      { id: 9, urls: ['https://b.test/'] }
    );
    expect(openWindowNumber(all, 9)).toBe(1);
    expect(openWindowNumber(all, 5)).toBeNull();
  });

  test('a window not there: null', async () => {
    const all = await windowsOf({ id: 5, urls: ['https://a.test/'] });
    expect(openWindowNumber(all, 7)).toBeNull();
  });
});
