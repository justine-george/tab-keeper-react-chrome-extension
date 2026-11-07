import { afterEach, describe, expect, test } from 'vitest';

import { generatePlaceholderURL } from '../../../utils/functions/local';
import type { OpenedTab } from '../../../utils/functions/openedCopy';
import {
  forgetSettled,
  showsItsPage,
  watchSettling,
} from '../../../utils/functions/settledPages';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

// KAN-893 spec, "What 'same page' means".
let handle: ChromeFakeHandle | undefined;
afterEach(() => {
  forgetSettled([11, 12]);
  handle?.restore();
  handle = undefined;
});

const OPENED = 'http://a.test/';
const PLACEHOLDER = generatePlaceholderURL('a', '', OPENED, 'Visit Site');

const opened = (tabId: number, openedUrl = OPENED): OpenedTab => ({
  tabId,
  place: { windowId: 1, index: 0, groupId: -1, group: null, pinned: false },
  openedUrl,
  saved: { tabId: 's', favicon: '', title: 'a', url: OPENED },
});

const start = (url: string) => {
  handle = setupChromeFake({
    windows: [
      {
        id: 1,
        tabs: [
          { id: 11, url },
          { id: 12, url: OPENED },
        ],
      },
    ],
  });
  return handle;
};

const tabNow = async (id: number) => chrome.tabs.get(id);

describe('showsItsPage', () => {
  test('a placeholder page that has not been visited yet', async () => {
    start(PLACEHOLDER);
    expect(showsItsPage(await tabNow(11), opened(11))).toBe(true);
  });

  test('the address it was opened with', async () => {
    start(OPENED);
    expect(showsItsPage(await tabNow(11), opened(11))).toBe(true);
  });

  test('its saved address, when it was opened as a placeholder', async () => {
    start(OPENED);
    expect(showsItsPage(await tabNow(11), opened(11, PLACEHOLDER))).toBe(true);
  });

  test('the same address as Chrome writes it (a trailing slash)', async () => {
    start('https://b.test/');
    expect(showsItsPage(await tabNow(11), opened(11, 'https://b.test'))).toBe(
      true
    );
  });

  test('the address its first load settled on (a redirect)', async () => {
    const fake = start(OPENED);
    watchSettling([11]);
    fake.browser.updateTab(11, {
      url: 'https://www.a.test/',
      status: 'complete',
    });
    expect(showsItsPage(await tabNow(11), opened(11))).toBe(true);
  });

  test('a placeholder visited: its real page settles, then a redirect', async () => {
    const fake = start(PLACEHOLDER);
    watchSettling([11]);
    fake.browser.updateTab(11, { status: 'complete' });
    fake.browser.updateTab(11, {
      url: 'https://www.a.test/',
      status: 'complete',
    });
    expect(showsItsPage(await tabNow(11), opened(11, PLACEHOLDER))).toBe(true);
  });

  test('only the first settle counts: a later page is navigated', async () => {
    const fake = start(OPENED);
    watchSettling([11]);
    fake.browser.updateTab(11, {
      url: 'https://www.a.test/',
      status: 'complete',
    });
    fake.browser.updateTab(11, { url: 'https://c.test/', status: 'complete' });
    expect(showsItsPage(await tabNow(11), opened(11))).toBe(false);
  });

  test('an address it is still loading, with no settle yet, is navigated', async () => {
    const fake = start(OPENED);
    watchSettling([11]);
    fake.browser.updateTab(11, { url: 'https://c.test/', status: 'loading' });
    expect(showsItsPage(await tabNow(11), opened(11))).toBe(false);
  });

  test('a tab never watched, showing another page, is navigated', async () => {
    start('https://c.test/');
    expect(showsItsPage(await tabNow(11), opened(11))).toBe(false);
  });

  test('a settle on another watched tab is not this one’s', async () => {
    const fake = start(OPENED);
    watchSettling([11, 12]);
    fake.browser.updateTab(12, { url: 'https://c.test/', status: 'complete' });
    fake.browser.updateTab(11, { url: 'https://d.test/', status: 'loading' });
    expect(showsItsPage(await tabNow(11), opened(11))).toBe(false);
  });

  test('forgetSettled drops what was learned', async () => {
    const fake = start(OPENED);
    watchSettling([11]);
    fake.browser.updateTab(11, {
      url: 'https://www.a.test/',
      status: 'complete',
    });
    forgetSettled([11]);
    expect(showsItsPage(await tabNow(11), opened(11))).toBe(false);
  });
});
