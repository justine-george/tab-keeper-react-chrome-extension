import { afterEach, describe, expect, test } from 'vitest';

import {
  isTabView,
  ownTabId,
  parseViewMode,
  pickNameSourceTab,
} from '../../../utils/functions/viewMode';
import { setupChromeFake } from '../../setup/chrome.fake';

// KAN-279 (Part D). `isTabView()` and `ownTabId()` read
// `window.location.search` and `chrome.tabs.getCurrent()`, both of which
// need a real DOM/global -- so this file runs under the jsdom ('components')
// project rather than 'unit' (node), despite testing plain functions and not
// a component. `.tsx` rather than a `// @vitest-environment jsdom` pragma:
// the project split is already by file extension (vite.config.ts), and this
// keeps that the only rule rather than adding a second, per-file one.

let handle: ReturnType<typeof setupChromeFake> | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  // isTabView() reads the live URL, and jsdom keeps one document (and one
  // location) for the whole file -- a test that moves it must put it back,
  // or an unrelated later test would inherit the tab view.
  window.history.replaceState(null, '', '/index.html');
});

describe('parseViewMode', () => {
  test.each<[string, string, 'tab' | 'popup']>([
    ['no query string', '', 'popup'],
    ['?view=tab', '?view=tab', 'tab'],
    ['wrong case is not tab', '?view=TAB', 'popup'],
    ['a different value', '?view=popup', 'popup'],
    ['view alongside another param', '?x=1&view=tab', 'tab'],
  ])('%s -> %s', (_label, search, expected) => {
    expect(parseViewMode(search)).toBe(expected);
  });
});

describe('isTabView', () => {
  test('true when the URL carries ?view=tab', () => {
    window.history.replaceState(null, '', '/index.html?view=tab');

    expect(isTabView()).toBe(true);
  });

  test('false with no query string, as the popup loads', () => {
    window.history.replaceState(null, '', '/index.html');

    expect(isTabView()).toBe(false);
  });

  // The interface's point: read per call, not memoised at module load, so a
  // page never has to reload for the answer to follow the URL.
  test('reads the URL fresh on every call, not once at module load', () => {
    window.history.replaceState(null, '', '/index.html');
    expect(isTabView()).toBe(false);

    window.history.replaceState(null, '', '/index.html?view=tab');

    expect(isTabView()).toBe(true);
  });
});

describe('ownTabId', () => {
  test('undefined in the popup, even with a current tab seeded', async () => {
    window.history.replaceState(null, '', '/index.html');
    handle = setupChromeFake({ tabs: [{ id: 10 }], currentTabId: 10 });

    expect(await ownTabId()).toBeUndefined();
  });

  test("the tab view's own id, from chrome.tabs.getCurrent()", async () => {
    window.history.replaceState(null, '', '/index.html?view=tab');
    handle = setupChromeFake({ tabs: [{ id: 10 }], currentTabId: 10 });

    expect(await ownTabId()).toBe(10);
  });
});

// Builds real chrome.tabs.Tab objects through the fake (query, not the seed
// literals directly) so no test here casts a partial object to the full
// Chrome type -- chrome.tabs.Tab carries a dozen required fields the fake
// already knows how to fill in.
async function fakeTabs(
  seeds: Partial<chrome.tabs.Tab>[]
): Promise<chrome.tabs.Tab[]> {
  const fakeHandle = setupChromeFake({ tabs: seeds });
  const tabs = await chrome.tabs.query({});
  fakeHandle.restore();
  return tabs;
}

describe('pickNameSourceTab', () => {
  test('own tab most recent -> falls through to the next most recent', async () => {
    const [own, docs, mail] = await fakeTabs([
      { id: 10, lastAccessed: 300 },
      { id: 11, title: 'Docs', lastAccessed: 200 },
      { id: 12, title: 'Mail', lastAccessed: 100 },
    ]);

    expect(pickNameSourceTab([own, docs, mail], own.id)).toBe(docs);
  });

  test('every lastAccessed undefined -> the first non-own tab in order', async () => {
    const [own, docs, mail] = await fakeTabs([
      { id: 10 },
      { id: 11, title: 'Docs' },
      { id: 12, title: 'Mail' },
    ]);

    expect(pickNameSourceTab([own, docs, mail], own.id)).toBe(docs);
  });

  test('only the own tab present -> undefined', async () => {
    const [own] = await fakeTabs([{ id: 10 }]);

    expect(pickNameSourceTab([own], own.id)).toBeUndefined();
  });
});
