import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createWindowWithRetries,
  isFocusSessionRequest,
  planWindowClosure,
  WindowSpec,
} from '../../../utils/functions/windows';

// Repeated rather than imported: it is private to local.ts, and the module
// that exports it publicly pulls in window.screen, which these tests lack.
const PLACEHOLDER_URL_PREFIX = 'data:text/html;base64,';

function tab(url: string, title = 'a title') {
  return { tabId: 'id', favicon: '', title, url };
}

function spec(overrides: Partial<WindowSpec> = {}): WindowSpec {
  return {
    tabs: [tab('https://example.com')],
    focused: true,
    bounds: { height: 100, width: 200, top: 10, left: 20 },
    ...overrides,
  };
}

// chrome.windows.create hands its result to a callback, so the fake has to as
// well. `results` is read one entry per call: undefined stands for the failure
// Chrome reports by invoking the callback with no window.
function stubChrome(results: (chrome.windows.Window | undefined)[]) {
  const createdWindows: chrome.windows.CreateData[] = [];
  const createdTabs: chrome.tabs.CreateProperties[] = [];
  let call = 0;

  const chromeStub = {
    windows: {
      create: (
        options: chrome.windows.CreateData,
        callback: (window?: chrome.windows.Window) => void
      ) => {
        createdWindows.push(options);
        callback(results[call++]);
      },
    },
    tabs: {
      create: (options: chrome.tabs.CreateProperties) => {
        createdTabs.push(options);
      },
    },
  };

  vi.stubGlobal('chrome', chromeStub);
  return { createdWindows, createdTabs };
}

function fakeWindow(id: number) {
  return { id } as chrome.windows.Window;
}

describe('planWindowClosure', () => {
  test('closes every previously open window once all replacements exist', () => {
    expect(planWindowClosure([1, 2, 3], [fakeWindow(9)])).toEqual([1, 2, 3]);
  });

  test('closes nothing when any window failed to open', () => {
    expect(planWindowClosure([1, 2], [fakeWindow(9), null])).toBeNull();
  });

  test('closes nothing when a created window has no id to compare against', () => {
    const idless = {} as chrome.windows.Window;
    expect(planWindowClosure([1, 2], [fakeWindow(9), idless])).toBeNull();
  });

  test('closes nothing when no window was even attempted', () => {
    expect(planWindowClosure([1, 2], [])).toBeNull();
  });

  test('never closes a window it just created', () => {
    expect(planWindowClosure([1, 9, 2], [fakeWindow(9)])).toEqual([1, 2]);
  });

  test('returns an empty plan, not a refusal, when nothing was open', () => {
    expect(planWindowClosure([], [fakeWindow(9)])).toEqual([]);
  });
});

describe('createWindowWithRetries', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('resolves the created window and opens the remaining tabs in it', async () => {
    const { createdWindows, createdTabs } = stubChrome([fakeWindow(7)]);

    const created = await createWindowWithRetries(
      spec({
        tabs: [tab('https://first.example'), tab('https://second.example')],
      }),
      'Go to URL',
      false,
      2
    );

    expect(created).toEqual(fakeWindow(7));
    expect(createdWindows).toHaveLength(1);
    expect(createdWindows[0]).toMatchObject({
      url: 'https://first.example',
      focused: true,
      height: 100,
      width: 200,
      top: 10,
      left: 20,
    });
    expect(createdTabs).toEqual([
      {
        windowId: 7,
        url: 'https://second.example',
        active: false,
      },
    ]);
  });

  test('opens later tabs as placeholders when lazy load is on', async () => {
    const { createdTabs } = stubChrome([fakeWindow(7)]);

    await createWindowWithRetries(
      spec({
        tabs: [tab('https://first.example'), tab('https://second.example')],
      }),
      'Go to URL',
      true,
      2
    );

    expect(createdTabs).toHaveLength(1);
    expect(createdTabs[0].url).toContain(PLACEHOLDER_URL_PREFIX);
  });

  test('retries without bounds after a failed attempt', async () => {
    const { createdWindows } = stubChrome([undefined, fakeWindow(8)]);

    const created = await createWindowWithRetries(
      spec(),
      'Go to URL',
      false,
      2
    );

    expect(created).toEqual(fakeWindow(8));
    expect(createdWindows).toHaveLength(2);
    expect(createdWindows[0]).toMatchObject({ height: 100, width: 200 });
    expect(createdWindows[1].height).toBeUndefined();
    expect(createdWindows[1].width).toBeUndefined();
  });

  test('resolves null once the retries are spent', async () => {
    const { createdWindows } = stubChrome([undefined, undefined]);

    const created = await createWindowWithRetries(
      spec(),
      'Go to URL',
      false,
      2
    );

    expect(created).toBeNull();
    expect(createdWindows).toHaveLength(2);
  });

  test('creates nothing when asked for a window with no tabs', async () => {
    const { createdWindows } = stubChrome([fakeWindow(7)]);

    const created = await createWindowWithRetries(
      spec({ tabs: [] }),
      'Go to URL',
      false,
      2
    );

    expect(created).toBeNull();
    expect(createdWindows).toHaveLength(0);
  });
});

describe('isFocusSessionRequest', () => {
  const valid = {
    type: 'focus-session',
    specs: [],
    goToURLText: 'Go to URL',
    isLazyLoad: true,
  };

  test('accepts a well formed request', () => {
    expect(isFocusSessionRequest(valid)).toBe(true);
  });

  test.each([
    ['a different message type', { ...valid, type: 'something-else' }],
    ['missing specs', { ...valid, specs: undefined }],
    ['a non boolean lazy load flag', { ...valid, isLazyLoad: 'yes' }],
    ['null', null],
    ['a bare string', 'focus-session'],
  ])('rejects %s', (_label, message) => {
    expect(isFocusSessionRequest(message)).toBe(false);
  });
});
