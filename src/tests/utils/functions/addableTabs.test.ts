import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { addableTabs } from '../../../utils/functions/capture';
import { buildChromeTab } from '../../fixtures/chromeTab';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

// KAN-886. What Add current window would add: the window's tabs minus Tab Keeper pages.
let handle: ChromeFakeHandle;
beforeEach(() => {
  handle = setupChromeFake();
});
afterEach(() => handle.restore());

const tab = (props: Partial<chrome.tabs.Tab>) =>
  buildChromeTab({ id: 1, ...props });
const win = (tabs?: chrome.tabs.Tab[]) => ({ tabs });
const tabKeeperUrl = () => chrome.runtime.getURL('index.html?view=tab');

describe('addableTabs (KAN-886)', () => {
  test('a window read without tabs adds nothing', () => {
    expect(addableTabs(win(undefined))).toEqual([]);
  });

  test('only Tab Keeper adds nothing', () => {
    expect(addableTabs(win([tab({ url: tabKeeperUrl() })]))).toEqual([]);
  });

  test('Tab Keeper beside a real tab adds just the real tab', () => {
    const real = tab({ id: 2, url: 'https://a.test/' });
    expect(addableTabs(win([tab({ url: tabKeeperUrl() }), real]))).toEqual([
      real,
    ]);
  });

  test('a Tab Keeper tab known only by its pending address adds nothing', () => {
    expect(
      addableTabs(win([tab({ url: '', pendingUrl: tabKeeperUrl() })]))
    ).toEqual([]);
  });
});
