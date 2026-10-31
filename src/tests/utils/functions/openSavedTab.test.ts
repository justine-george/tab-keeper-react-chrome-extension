import { afterEach, describe, expect, test, vi } from 'vitest';

import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';
import {
  findOpenCopy,
  opensInBackground,
  switchToOpenCopy,
} from '../../../utils/functions/openSavedTab';
import { generatePlaceholderURL } from '../../../utils/functions/local';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

// KAN-884. A saved tab's plain click switches to an open copy of its address.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

let nextId = 100;
const tab = (url: string, extra: Partial<OpenTab> = {}): OpenTab => ({
  id: nextId++,
  windowId: 0,
  title: url,
  url,
  favIconUrl: '',
  active: false,
  pinned: false,
  audible: false,
  muted: false,
  groupId: null,
  index: 0,
  ...extra,
});

const win = (
  id: number,
  tabs: OpenTab[],
  isThisWindow = false
): OpenWindow => ({
  id,
  isThisWindow,
  tabs: tabs.map((t) => ({ ...t, windowId: id })),
  groups: [],
  bounds: null,
  state: 'normal',
  incognito: false,
});

const SUSPENDED =
  'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Docs&url=https%3A%2F%2Fdocs.test%2Fpage&time=1788097428448';

describe('findOpenCopy', () => {
  test('finds a tab at the same address in another window', () => {
    const windows = [
      win(1, [tab('https://a.test/')], true),
      win(2, [tab('https://b.test/'), tab('https://docs.test/page')]),
    ];
    expect(findOpenCopy('https://docs.test/page', windows)).toMatchObject({
      windowId: 2,
      url: 'https://docs.test/page',
    });
  });

  test('none when no open tab has the address', () => {
    const windows = [win(1, [tab('https://a.test/')], true)];
    expect(findOpenCopy('https://docs.test/page', windows)).toBeUndefined();
  });

  test('the address is compared exactly: #a is not #b, and no trailing-slash fix', () => {
    const windows = [
      win(1, [tab('https://docs.test/page#a'), tab('https://docs.test/x/')]),
    ];
    expect(findOpenCopy('https://docs.test/page#b', windows)).toBeUndefined();
    expect(findOpenCopy('https://docs.test/page', windows)).toBeUndefined();
    expect(findOpenCopy('https://docs.test/x', windows)).toBeUndefined();
  });

  test('a suspended open tab matches its real page', () => {
    const windows = [win(1, [tab(SUSPENDED)])];
    expect(findOpenCopy('https://docs.test/page', windows)?.url).toBe(
      SUSPENDED
    );
  });

  test('a saved lazy-load placeholder matches the open real page', () => {
    const saved = generatePlaceholderURL(
      'Docs',
      '',
      'https://docs.test/page',
      'Go'
    );
    const windows = [win(1, [tab('https://docs.test/page')])];
    expect(findOpenCopy(saved, windows)?.url).toBe('https://docs.test/page');
  });

  test('a saved tab with no address never matches, even an open one with none', () => {
    const windows = [win(1, [tab('')], true)];
    expect(findOpenCopy('', windows)).toBeUndefined();
  });

  test("Tab Keeper's own window wins over one used later elsewhere", () => {
    const own = tab('https://docs.test/page', { lastAccessed: 10 });
    const other = tab('https://docs.test/page', { lastAccessed: 99 });
    const windows = [win(2, [other]), win(1, [own], true)];
    expect(findOpenCopy('https://docs.test/page', windows)?.id).toBe(own.id);
  });

  test('outside its own window, the one used last wins', () => {
    const older = tab('https://docs.test/page', { lastAccessed: 10 });
    const newer = tab('https://docs.test/page', { lastAccessed: 50 });
    const windows = [
      win(1, [tab('https://a.test/')], true),
      win(2, [older]),
      win(3, [newer]),
    ];
    expect(findOpenCopy('https://docs.test/page', windows)?.id).toBe(newer.id);
  });

  test('two in its own window: the one used last', () => {
    const older = tab('https://docs.test/page', { lastAccessed: 10 });
    const newer = tab('https://docs.test/page', { lastAccessed: 50 });
    const windows = [win(1, [older, newer], true)];
    expect(findOpenCopy('https://docs.test/page', windows)?.id).toBe(newer.id);
  });

  test("without lastAccessed, Currently open's order: this window, then Chrome's order", () => {
    const first = tab('https://docs.test/page');
    const second = tab('https://docs.test/page');
    const windows = [win(2, [first]), win(3, [second])];
    expect(findOpenCopy('https://docs.test/page', windows)?.id).toBe(first.id);
  });
});

describe('opensInBackground', () => {
  const press = (over: Partial<MouseEvent>) => ({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    ...over,
  });

  test('a plain click does not', () => {
    expect(opensInBackground(press({}), true)).toBe(false);
    expect(opensInBackground(press({}), false)).toBe(false);
  });

  test('a middle-click does, on every platform', () => {
    expect(opensInBackground(press({ button: 1 }), true)).toBe(true);
    expect(opensInBackground(press({ button: 1 }), false)).toBe(true);
  });

  test('⌘-click on a Mac does; Ctrl-click there does not (it is the context menu)', () => {
    expect(opensInBackground(press({ metaKey: true }), true)).toBe(true);
    expect(opensInBackground(press({ ctrlKey: true }), true)).toBe(false);
  });

  test('Ctrl-click off a Mac does; the Windows key does not', () => {
    expect(opensInBackground(press({ ctrlKey: true }), false)).toBe(true);
    expect(opensInBackground(press({ metaKey: true }), false)).toBe(false);
  });
});

describe('switchToOpenCopy', () => {
  const activeIn = async (windowId: number) =>
    (await chrome.tabs.query({ active: true, windowId }))[0];

  test('switches to the open copy and focuses its window', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [{ id: 10, url: 'https://a.test/', active: true }],
        },
        {
          id: 2,
          focused: false,
          tabs: [
            { id: 20, url: 'https://b.test/', active: true },
            { id: 21, url: 'https://docs.test/page' },
          ],
        },
      ],
    });

    expect(await switchToOpenCopy('https://docs.test/page')).toBe(true);

    expect((await activeIn(2))?.id).toBe(21);
    expect((await chrome.windows.getLastFocused()).id).toBe(2);
  });

  test("prefers the copy in Tab Keeper's own window", async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 10, url: 'https://a.test/', active: true },
            { id: 11, url: 'https://docs.test/page', lastAccessed: 1 },
          ],
        },
        {
          id: 2,
          tabs: [{ id: 21, url: 'https://docs.test/page', lastAccessed: 9 }],
        },
      ],
    });

    expect(await switchToOpenCopy('https://docs.test/page')).toBe(true);
    expect((await activeIn(1))?.id).toBe(11);
  });

  test('false, and nothing changes, when no copy is open', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [{ id: 10, url: 'https://a.test/', active: true }],
        },
      ],
    });
    const update = vi.spyOn(chrome.tabs, 'update');

    expect(await switchToOpenCopy('https://docs.test/page')).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  test('false when the copy closes between the lookup and the switch', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 10, url: 'https://a.test/', active: true },
            { id: 11, url: 'https://docs.test/page' },
          ],
        },
      ],
    });
    vi.spyOn(chrome.tabs, 'update').mockRejectedValue(
      new Error('No tab with id: 11.')
    );

    expect(await switchToOpenCopy('https://docs.test/page')).toBe(false);
  });

  test('false when the open windows cannot be read', async () => {
    handle = setupChromeFake({ windows: [{ id: 1, focused: true }] });
    vi.spyOn(chrome.windows, 'getAll').mockRejectedValue(new Error('gone'));

    expect(await switchToOpenCopy('https://docs.test/page')).toBe(false);
  });
});
