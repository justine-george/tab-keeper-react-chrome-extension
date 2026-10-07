import { afterEach, describe, expect, test, vi } from 'vitest';

import { restoreSession } from '../../../utils/functions/restoreSession';
import {
  RESTORE_SESSION_MESSAGE,
  type RestoreSessionRequest,
  type WindowSpec,
} from '../../../utils/functions/windows';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// KAN-459. The spec's "Through Save / Open / Switch" table, at the worker.
const EXT = 'chrome-extension://faketestid/';
const FULL = `${EXT}index.html?view=tab`;
const STUB = `${EXT}pinned.html`;
const web = (name: string) => `https://${name}.test/`;

let handle: ChromeFakeHandle | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const spec = (name: string, focused: boolean): WindowSpec => ({
  tabs: [{ tabId: name, favicon: '', title: name, url: web(name) }],
  focused,
  bounds: null,
});

const request = (
  names: string[],
  closeOtherWindows: boolean,
  pinTabKeeper: boolean
): RestoreSessionRequest => ({
  type: RESTORE_SESSION_MESSAGE,
  specs: names.map((name, i) => spec(name, i === 0)),
  goToURLText: 'Visit Site',
  closeOtherWindows,
  pinTabKeeper,
});

// Every normal window: its tabs in order, as url/pinned/active.
async function layout() {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  return all.map((win) => ({
    id: win.id,
    tabs: (win.tabs ?? [])
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((t) => ({ url: t.url, pinned: t.pinned, active: t.active })),
  }));
}
const newWindows = async (before: number[]) =>
  (await layout()).filter((w) => !before.includes(w.id ?? -1));

// The window an open tab is in; undefined once it has closed (windows.remove does not record its tabs).
const windowOf = async (tabId: number) =>
  (await chrome.tabs.query({})).find((t) => t.id === tabId)?.windowId;

const seed = (extra: ChromeSeed = {}): ChromeSeed => ({
  windows: [
    { id: 1, focused: true, tabs: [{ id: 10, url: web('old'), active: true }] },
  ],
  ...extra,
});

describe('Open (closeOtherWindows false)', () => {
  test('Off: the new window has no Tab Keeper tab', async () => {
    handle = setupChromeFake(seed());
    await restoreSession(request(['a'], false, false));
    const [made] = await newWindows([1]);
    expect(made.tabs.map((t) => t.url)).toEqual([web('a')]);
  });

  test('On: every new window starts with a pinned stub; the session tab stays active', async () => {
    handle = setupChromeFake(seed());
    await restoreSession(request(['a', 'b'], false, true));
    const made = await newWindows([1]);
    expect(made).toHaveLength(2);
    for (const win of made) {
      expect(win.tabs[0]).toEqual({ url: STUB, pinned: true, active: false });
      expect(win.tabs[1].active).toBe(true);
    }
    expect((await layout()).find((w) => w.id === 1)).toBeDefined();
  });
});

describe('Switch (closeOtherWindows true)', () => {
  const pinnedFullViewIn = (windowId: number, focused: boolean) => ({
    id: windowId,
    focused,
    tabs: [
      { id: windowId * 10, url: FULL, pinned: true },
      { id: windowId * 10 + 1, url: web(`old${windowId}`), active: true },
    ],
  });

  test('Off, nothing pinned: as today, old windows close, no Tab Keeper tab anywhere', async () => {
    handle = setupChromeFake(seed());
    await restoreSession(request(['a'], true, false));
    const all = await layout();
    expect(all.map((w) => w.tabs.map((t) => t.url))).toEqual([[web('a')]]);
  });

  test('Off, a hand-pinned full view: it is carried into the focused new window, pinned, at index 0', async () => {
    handle = setupChromeFake({ windows: [pinnedFullViewIn(1, true)] });
    await restoreSession(request(['a', 'b'], true, false));
    const all = await layout();
    expect(all).toHaveLength(2);
    expect(all[0].tabs).toEqual([
      { url: FULL, pinned: true, active: false },
      { url: web('a'), pinned: false, active: true },
    ]);
    expect(all[1].tabs.map((t) => t.url)).toEqual([web('b')]);
    expect(await windowOf(10)).toBe(all[0].id);
  });

  test('On, a pinned full view: carried into the focused window, stubs in the others', async () => {
    handle = setupChromeFake({ windows: [pinnedFullViewIn(1, true)] });
    await restoreSession(request(['a', 'b'], true, true));
    const all = await layout();
    expect(all[0].tabs.map((t) => t.url)).toEqual([FULL, web('a')]);
    expect(all[1].tabs.map((t) => t.url)).toEqual([STUB, web('b')]);
    expect(all[1].tabs[0].pinned).toBe(true);
  });

  test('On, nothing pinned: the focused window gets a stub too', async () => {
    handle = setupChromeFake(seed());
    await restoreSession(request(['a'], true, true));
    const all = await layout();
    expect(all.map((w) => w.tabs.map((t) => t.url))).toEqual([
      [STUB, web('a')],
    ]);
  });

  test("several pinned Tab Keeper tabs: the last-focused window's is carried, the rest close", async () => {
    handle = setupChromeFake({
      windows: [pinnedFullViewIn(1, false), pinnedFullViewIn(2, true)],
    });
    await restoreSession(request(['a'], true, true));
    const all = await layout();
    expect(all).toHaveLength(1);
    expect(all[0].tabs.map((t) => t.url)).toEqual([FULL, web('a')]);
    expect(await windowOf(10)).toBeUndefined();
    expect(await windowOf(20)).toBe(all[0].id);
  });

  test('a pinned tab alone in its window: the move empties it, and the close that follows is harmless', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, focused: true, tabs: [{ id: 10, url: FULL, pinned: true }] },
      ],
    });
    await restoreSession(request(['a'], true, false));
    const all = await layout();
    expect(all.map((w) => w.tabs.map((t) => t.url))).toEqual([
      [FULL, web('a')],
    ]);
    expect(await windowOf(10)).toBe(all[0].id);
    // Window 1 had already closed itself; this remove found nothing to close.
    expect(handle.removedWindowIds).toEqual([1]);
  });

  test('a failed window moves nothing and closes nothing', async () => {
    handle = setupChromeFake({
      windows: [pinnedFullViewIn(1, true)],
      refusedUrls: [web('b')],
    });
    await restoreSession(request(['a', 'b'], true, true));
    const old = (await layout()).find((w) => w.id === 1);
    expect(old?.tabs[0]).toEqual({ url: FULL, pinned: true, active: false });
    expect(handle.removedWindowIds).toEqual([]);
  });

  test('a refused move keeps the window holding the pinned tab open, closes the others, and stubs the focused window when On', async () => {
    handle = setupChromeFake({
      windows: [
        pinnedFullViewIn(1, true),
        { id: 2, tabs: [{ id: 30, url: web('other') }] },
      ],
    });
    vi.spyOn(chrome.tabs, 'move').mockRejectedValue(new Error('refused'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await restoreSession(request(['a'], true, true));
    expect(handle.removedWindowIds).toEqual([2]);
    const all = await layout();
    expect(all.find((w) => w.id === 1)?.tabs[0].url).toBe(FULL);
    const made = all.find((w) => w.id !== 1);
    expect(made?.tabs.map((t) => t.url)).toEqual([STUB, web('a')]);
  });
});
