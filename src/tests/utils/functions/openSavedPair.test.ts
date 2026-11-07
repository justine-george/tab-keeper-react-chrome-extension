import { afterEach, describe, expect, test, vi } from 'vitest';

import type { tabData } from '../../../redux/slices/tabContainerDataStateSlice';
import {
  openPairBesideActive,
  pairClickSwitches,
  switchToOpenPair,
} from '../../../utils/functions/openSavedPair';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// KAN-942. A click on either half of a saved pair: a split that's open, else the clicked half if both are open, else both, split.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const L = 'https://left.test/';
const R = 'https://right.test/';
const half = (name: string, url: string): tabData => ({
  tabId: name,
  favicon: '',
  title: name,
  url,
  splitId: 's',
});
const LEFT = half('left', L);
const RIGHT = half('right', R);

const live = (other: ChromeSeed['windows'] = []) =>
  setupChromeFake({
    splitView: true,
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, url: 'https://here.test/', active: true }, { id: 11 }],
      },
      ...(other ?? []),
    ],
  });

const activeIn = async (windowId: number) =>
  (await chrome.tabs.query({ active: true, windowId }))[0]?.id;

describe('pairClickSwitches (KAN-942)', () => {
  test('only with both halves open', () => {
    expect(pairClickSwitches(L, R, new Set([L, R]))).toBe(true);
    expect(pairClickSwitches(L, R, new Set([L]))).toBe(false);
    expect(pairClickSwitches(L, R, new Set([R]))).toBe(false);
    expect(pairClickSwitches(L, R, new Set())).toBe(false);
  });
});

describe('switchToOpenPair (KAN-942)', () => {
  test('both open as a split: the clicked half in it, over a lone copy elsewhere', async () => {
    handle = live([
      {
        id: 2,
        tabs: [
          { id: 20, url: R, active: true },
          { id: 21, url: L },
        ],
      },
      {
        id: 3,
        tabs: [
          { id: 30, active: true },
          { id: 31, url: L, splitViewId: 70 },
          { id: 32, url: R, splitViewId: 70 },
        ],
      },
    ]);
    expect(await switchToOpenPair(R, L)).toBe(true);
    expect(await activeIn(3)).toBe(32);
  });

  test('both open, not as a split: the clicked half', async () => {
    handle = live([
      {
        id: 2,
        tabs: [
          { id: 20, url: R, active: true },
          { id: 21, url: L },
        ],
      },
    ]);
    expect(await switchToOpenPair(L, R)).toBe(true);
    expect(await activeIn(2)).toBe(21);
  });

  test('two halves of different splits are no split of theirs', async () => {
    handle = live([
      {
        id: 2,
        tabs: [
          { id: 20, url: L, splitViewId: 70, active: true },
          { id: 21, url: 'https://x.test/', splitViewId: 70 },
          { id: 22, url: R, splitViewId: 71 },
          { id: 23, url: 'https://y.test/', splitViewId: 71 },
        ],
      },
    ]);
    expect(await switchToOpenPair(R, L)).toBe(true);
    expect(await activeIn(2)).toBe(22);
  });

  test('one half open: false, so the caller opens both', async () => {
    handle = live([{ id: 2, tabs: [{ id: 20, url: L, active: true }] }]);
    expect(await switchToOpenPair(L, R)).toBe(false);
  });

  test('neither open: false', async () => {
    handle = live();
    expect(await switchToOpenPair(L, R)).toBe(false);
  });

  test('windows that can’t be read: false', async () => {
    handle = live();
    vi.spyOn(chrome.windows, 'getAll').mockRejectedValue(new Error('no'));
    expect(await switchToOpenPair(L, R)).toBe(false);
  });
});

describe('openPairBesideActive (KAN-942)', () => {
  const urlsNow = async () =>
    (await chrome.tabs.query({ windowId: 1 }))
      .sort((a, b) => a.index - b.index)
      .map((t) => t.url);

  test('both open beside the current tab, split, saved order kept', async () => {
    handle = live();
    await openPairBesideActive(LEFT, RIGHT, RIGHT, true);
    const tabs = (await chrome.tabs.query({ windowId: 1 })).sort(
      (a, b) => a.index - b.index
    );
    expect(tabs.map((t) => t.url).slice(1, 3)).toEqual([L, R]);
    expect(tabs[1].splitViewId).toBeGreaterThan(0);
    expect(tabs[1].splitViewId).toBe(tabs[2].splitViewId);
  });

  test('in front, the clicked half forward', async () => {
    handle = live();
    await openPairBesideActive(LEFT, RIGHT, RIGHT, true);
    const [front] = await chrome.tabs.query({ active: true, windowId: 1 });
    expect(front.url).toBe(R);
  });

  test('the first half clicked comes forward too', async () => {
    handle = live();
    await openPairBesideActive(LEFT, RIGHT, LEFT, true);
    const [front] = await chrome.tabs.query({ active: true, windowId: 1 });
    expect(front.url).toBe(L);
  });

  test('behind: the front tab stays', async () => {
    handle = live();
    await openPairBesideActive(LEFT, RIGHT, LEFT, false);
    expect(await activeIn(1)).toBe(10);
    expect(await urlsNow()).toHaveLength(4);
  });

  test('forward only after the split, as the popup closes on it', async () => {
    handle = live();
    const order: string[] = [];
    const update = chrome.tabs.update.bind(chrome.tabs);
    vi.spyOn(chrome.tabs, 'update').mockImplementation(((
      ...args: Parameters<typeof update>
    ) => {
      order.push('front');
      return update(...args);
    }) as typeof chrome.tabs.update);
    const createSplit: unknown = Reflect.get(chrome.tabs, 'createSplit');
    Reflect.set(chrome.tabs, 'createSplit', (ids: number[]) => {
      order.push('split');
      return Reflect.apply(
        createSplit as (i: number[]) => Promise<number>,
        chrome.tabs,
        [ids]
      );
    });
    await openPairBesideActive(LEFT, RIGHT, LEFT, true);
    expect(order).toEqual(['split', 'front']);
  });

  test('before Chrome 155: two tabs side by side, still in front', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1, focused: true, tabs: [{ id: 10, active: true }] }],
    });
    await openPairBesideActive(LEFT, RIGHT, RIGHT, true);
    expect((await urlsNow()).slice(1)).toEqual([L, R]);
    const [front] = await chrome.tabs.query({ active: true, windowId: 1 });
    expect(front.url).toBe(R);
  });

  test('a refused clicked half: the other comes forward', async () => {
    handle = live();
    const create = chrome.tabs.create.bind(chrome.tabs);
    type Answer = (tab?: chrome.tabs.Tab) => void;
    Reflect.set(
      chrome.tabs,
      'create',
      (properties: chrome.tabs.CreateProperties, answer: Answer) =>
        properties.url === R ? answer(undefined) : create(properties, answer)
    );
    await openPairBesideActive(LEFT, RIGHT, RIGHT, true);
    const [front] = await chrome.tabs.query({ active: true, windowId: 1 });
    expect(front.url).toBe(L);
  });
});
