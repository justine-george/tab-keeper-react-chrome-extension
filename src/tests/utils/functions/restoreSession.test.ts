import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { generatePlaceholderURL } from '../../../utils/functions/local';
import type { SavedWindowState } from '../../../redux/slices/tabContainerDataStateSlice';
import {
  FULLSCREEN_FOCUS_SETTLE_MS,
  restoreSession,
} from '../../../utils/functions/restoreSession';
import {
  RESTORE_SESSION_MESSAGE,
  type RestoreSessionRequest,
  type WindowSpec,
  WINDOW_SETTLE_MS,
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
    expect(all[0].tabs).toEqual([
      { url: FULL, pinned: true, active: false },
      { url: web('a'), pinned: false, active: true },
    ]);
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

  test('no window marked focused: the pinned tab stays in its window, which stays open; the others close', async () => {
    handle = setupChromeFake({
      windows: [
        pinnedFullViewIn(1, true),
        { id: 2, tabs: [{ id: 30, url: web('other') }] },
      ],
    });
    const unfocused = request(['a', 'b'], true, true);
    await restoreSession({
      ...unfocused,
      specs: unfocused.specs.map((s) => ({ ...s, focused: false })),
    });
    expect(handle.removedWindowIds).toEqual([2]);
    expect(await windowOf(10)).toBe(1);
    expect((await layout()).find((w) => w.id === 1)?.tabs[0]).toEqual({
      url: FULL,
      pinned: true,
      active: false,
    });
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

  test('a refused saved active tab: the window opens on the fallback and the old windows still close (KAN-458)', async () => {
    handle = setupChromeFake(seed({ refusedUrls: [web('a3')] }));
    const tab = (name: string, pinned: boolean) => ({
      tabId: name,
      favicon: '',
      title: name,
      url: web(name),
      ...(pinned ? { pinned: true as const } : {}),
    });
    const lazy = (name: string) =>
      generatePlaceholderURL(
        name,
        '/images/favicon.ico',
        web(name),
        'Visit Site'
      );
    await restoreSession({
      ...request([], true, false),
      specs: [
        {
          tabs: [tab('p1', true), tab('x2', false), tab('a3', false)],
          focused: true,
          bounds: null,
          activeTabId: 'a3',
        },
      ],
    });
    expect(handle.removedWindowIds).toEqual([1]);
    expect((await layout()).map((w) => w.tabs)).toEqual([
      [
        { url: lazy('p1'), pinned: true, active: false },
        { url: web('x2'), pinned: false, active: true },
        { url: lazy('a3'), pinned: false, active: false },
      ],
    ]);
  });
});

describe('a session with pinned tabs (KAN-458)', () => {
  const pinnedSpec = (): WindowSpec => ({
    tabs: [
      { tabId: 'p', favicon: '', title: 'p', url: web('p'), pinned: true },
      { tabId: 'a', favicon: '', title: 'a', url: web('a') },
    ],
    focused: true,
    bounds: null,
  });
  const pinnedRequest = (
    closeOtherWindows: boolean,
    pinTabKeeper: boolean
  ): RestoreSessionRequest => ({
    type: RESTORE_SESSION_MESSAGE,
    specs: [pinnedSpec()],
    goToURLText: 'Visit Site',
    closeOtherWindows,
    pinTabKeeper,
  });
  const lazyP = generatePlaceholderURL(
    'p',
    '/images/favicon.ico',
    web('p'),
    'Visit Site'
  );

  test('On: the stub first, then the session pinned tab, the first unpinned tab active', async () => {
    handle = setupChromeFake(seed());
    await restoreSession(pinnedRequest(false, true));
    const [made] = await newWindows([1]);
    expect(made.tabs).toEqual([
      { url: STUB, pinned: true, active: false },
      { url: lazyP, pinned: true, active: false },
      { url: web('a'), pinned: false, active: true },
    ]);
  });

  test('Switch carries a pinned full view to index 0, before the session pinned tab', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 10, url: FULL, pinned: true },
            { id: 11, url: web('old'), active: true },
          ],
        },
      ],
    });
    await restoreSession(pinnedRequest(true, false));
    const all = await layout();
    expect(all).toHaveLength(1);
    expect(all[0].tabs).toEqual([
      { url: FULL, pinned: true, active: false },
      { url: lazyP, pinned: true, active: false },
      { url: web('a'), pinned: false, active: true },
    ]);
  });
});

// KAN-460, measured headed: a saved state applied to another window can take focus from Window 1.
describe('Window 1 gets focus back after other windows take their saved state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Window 1 is the first spec; each state belongs to the spec at its index.
  const stated = (
    states: (SavedWindowState | undefined)[],
    closeOtherWindows: boolean
  ): RestoreSessionRequest => {
    const base = request(
      states.map((_, i) => `w${i + 1}`),
      closeOtherWindows,
      false
    );
    return {
      ...base,
      specs: base.specs.map((s, i) => {
        const state = states[i];
        return state === undefined ? s : { ...s, state };
      }),
    };
  };
  const focusCalls = (update: { mock: { calls: unknown[][] } }) =>
    update.mock.calls.filter(([, props]) => 'focused' in (props as object));
  // Window 1's id: the window its tab opened in.
  const windowOne = async () =>
    (await layout()).find((w) => w.tabs[0]?.url === web('w1'))?.id;
  // Past the age wait and the read-back in createWindowWithRetries.
  const filled = () => vi.advanceTimersByTimeAsync(2 * WINDOW_SETTLE_MS);

  test('a maximized Window 2: Window 1 is focused after the state calls, and is the last-focused window', async () => {
    handle = setupChromeFake(seed());
    const update = vi.spyOn(chrome.windows, 'update');
    const done = restoreSession(stated([undefined, 'maximized'], false));
    await filled();
    await done;

    const id = await windowOne();
    const calls = update.mock.calls.map(([, props]) => props);
    expect(focusCalls(update)).toEqual([[id, { focused: true }]]);
    const focusAt = calls.findIndex((props) => 'focused' in props);
    expect(calls.slice(0, focusAt).some((props) => 'state' in props)).toBe(
      true
    );
    expect(calls.slice(focusAt).some((props) => 'state' in props)).toBe(false);
    expect((await chrome.windows.getLastFocused()).id).toBe(id);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([false, true])(
    'no saved state anywhere (closeOtherWindows %s): no focus call, and no timer left',
    async (closeOtherWindows) => {
      handle = setupChromeFake(seed());
      const update = vi.spyOn(chrome.windows, 'update');
      await restoreSession(stated([undefined, undefined], closeOtherWindows));
      expect(focusCalls(update)).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  test.each([
    ['Open', false],
    ['Switch', true],
  ])(
    '%s with a full-screen Window 2: a second focus call comes FULLSCREEN_FOCUS_SETTLE_MS after the first, not before',
    async (_, closeOtherWindows) => {
      handle = setupChromeFake(seed());
      const update = vi.spyOn(chrome.windows, 'update');
      const done = restoreSession(
        stated([undefined, 'fullscreen'], closeOtherWindows)
      );
      await filled();
      const id = await windowOne();
      expect(focusCalls(update)).toEqual([[id, { focused: true }]]);

      await vi.advanceTimersByTimeAsync(FULLSCREEN_FOCUS_SETTLE_MS - 1);
      expect(focusCalls(update)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(focusCalls(update)).toEqual([
        [id, { focused: true }],
        [id, { focused: true }],
      ]);
      expect((await chrome.windows.getLastFocused()).id).toBe(id);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  test('only Window 1 has a state: no focus call', async () => {
    handle = setupChromeFake(seed());
    const update = vi.spyOn(chrome.windows, 'update');
    const done = restoreSession(stated(['fullscreen', undefined], false));
    await filled();
    await done;
    expect(focusCalls(update)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a Switch with nothing to close and a full-screen Window 2: Window 1 still gets the second focus call', async () => {
    handle = setupChromeFake({ windows: [] });
    const update = vi.spyOn(chrome.windows, 'update');
    const done = restoreSession(stated([undefined, 'fullscreen'], true));
    await filled();
    const id = await windowOne();
    await vi.advanceTimersByTimeAsync(FULLSCREEN_FOCUS_SETTLE_MS);
    await done;
    expect(handle.removedWindowIds).toEqual([]);
    expect(focusCalls(update)).toEqual([
      [id, { focused: true }],
      [id, { focused: true }],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('Window 2 has a state but its window fails to open: no focus call', async () => {
    handle = setupChromeFake(seed({ refusedUrls: [web('w2')] }));
    const update = vi.spyOn(chrome.windows, 'update');
    const done = restoreSession(stated([undefined, 'fullscreen'], false));
    await filled();
    await vi.advanceTimersByTimeAsync(FULLSCREEN_FOCUS_SETTLE_MS);
    await done;
    expect(await newWindows([1])).toHaveLength(1);
    expect(focusCalls(update)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a refused focus warns, and the restore still resolves', async () => {
    handle = setupChromeFake(seed());
    const update = chrome.windows.update.bind(chrome.windows);
    vi.spyOn(chrome.windows, 'update').mockImplementation(((
      id: number,
      props: chrome.windows.UpdateInfo
    ) =>
      props.focused === true
        ? Promise.reject(new Error('refused'))
        : update(id, props)) as typeof chrome.windows.update);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const done = restoreSession(stated([undefined, 'fullscreen'], true));
    await filled();
    await vi.advanceTimersByTimeAsync(FULLSCREEN_FOCUS_SETTLE_MS);

    await expect(done).resolves.toBeUndefined();
    expect(warn.mock.calls).toEqual([
      ['Could not give the restored Window 1 focus back:', expect.any(Error)],
      ['Could not give the restored Window 1 focus back:', expect.any(Error)],
    ]);
    expect(handle.removedWindowIds).toEqual([1]);
  });
});

// KAN-460 Part 3 (ledger 2026-10-09-kan-460-part-3-incognito-measurement.md). Pick (b): Switch carries the Tab Keeper tab into the first restored normal window.
describe('incognito windows', () => {
  const incognitoRequest = (
    incognito: readonly boolean[],
    closeOtherWindows: boolean,
    pinTabKeeper: boolean
  ): RestoreSessionRequest => {
    const base = request(
      incognito.map((_, i) => `w${i + 1}`),
      closeOtherWindows,
      pinTabKeeper
    );
    return {
      ...base,
      specs: base.specs.map((s, i) =>
        incognito[i] ? { ...s, incognito: true } : s
      ),
    };
  };
  const pinnedFullView = (incognitoAllowed: boolean): ChromeSeed => ({
    incognitoAllowed,
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, url: FULL, pinned: true },
          { id: 11, url: web('old'), active: true },
        ],
      },
    ],
  });
  // Each window as incognito plus its urls, keyed by its first session tab.
  async function byWindow() {
    const all = await chrome.windows.getAll({ populate: true });
    return Object.fromEntries(
      all.map((win) => {
        const urls = (win.tabs ?? [])
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((t) => t.url ?? '');
        const key = urls.find((u) => !u.startsWith(EXT)) ?? `window ${win.id}`;
        return [key, { incognito: win.incognito, urls }];
      })
    );
  }

  test('allowed: a window saved incognito opens incognito, the other normal', async () => {
    handle = setupChromeFake(seed({ incognitoAllowed: true }));
    await restoreSession(incognitoRequest([true, false], false, false));
    const made = await byWindow();
    expect(made[web('w1')]).toEqual({ incognito: true, urls: [web('w1')] });
    expect(made[web('w2')]).toEqual({ incognito: false, urls: [web('w2')] });
  });

  test('not allowed: it opens normal, and Chrome is never asked for an incognito window', async () => {
    handle = setupChromeFake(seed());
    await restoreSession(incognitoRequest([true], true, false));
    expect((await byWindow())[web('w1')]).toEqual({
      incognito: false,
      urls: [web('w1')],
    });
    expect(handle.unseenIncognitoWindows).toBe(0);
    expect(handle.removedWindowIds).toEqual([1]);
  });

  test('a refused access check reads as not allowed', async () => {
    handle = setupChromeFake(seed({ incognitoAllowed: true }));
    vi.spyOn(chrome.extension, 'isAllowedIncognitoAccess').mockRejectedValue(
      new Error('refused')
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await restoreSession(incognitoRequest([true], false, false));
    expect((await byWindow())[web('w1')].incognito).toBe(false);
  });

  test('Open, On: the normal window gets a stub, the incognito one none, and no stub lands anywhere else', async () => {
    handle = setupChromeFake(seed({ incognitoAllowed: true }));
    await restoreSession(incognitoRequest([true, false], false, true));
    const made = await byWindow();
    expect(made[web('w1')].urls).toEqual([web('w1')]);
    expect(made[web('w2')].urls).toEqual([STUB, web('w2')]);
    expect(made[web('old')].urls).toEqual([web('old')]);
  });

  test('Switch, Window 1 incognito: the pinned full view is carried into Window 2, which gets no stub; the old window closes', async () => {
    handle = setupChromeFake(pinnedFullView(true));
    await restoreSession(incognitoRequest([true, false], true, true));
    const made = await byWindow();
    expect(Object.keys(made)).toHaveLength(2);
    expect(made[web('w1')]).toEqual({ incognito: true, urls: [web('w1')] });
    expect(made[web('w2')].urls).toEqual([FULL, web('w2')]);
    expect((await chrome.tabs.query({})).find((t) => t.id === 10)?.pinned).toBe(
      true
    );
    expect(handle.removedWindowIds).toEqual([1]);
  });

  test('Switch, every window incognito: the window holding the pinned tab stays open, no stub anywhere', async () => {
    handle = setupChromeFake(pinnedFullView(true));
    await restoreSession(incognitoRequest([true, true], true, true));
    const made = await byWindow();
    expect(made[web('old')].urls).toEqual([FULL, web('old')]);
    expect(made[web('w1')].urls).toEqual([web('w1')]);
    expect(made[web('w2')].urls).toEqual([web('w2')]);
    expect(handle.removedWindowIds).toEqual([]);
  });

  test('Switch, Window 1 incognito, a refused carry: the old window stays open and Window 2 gets the stub', async () => {
    handle = setupChromeFake(pinnedFullView(true));
    vi.spyOn(chrome.tabs, 'move').mockRejectedValue(new Error('refused'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await restoreSession(incognitoRequest([true, false], true, true));
    const made = await byWindow();
    expect(made[web('old')].urls).toEqual([FULL, web('old')]);
    expect(made[web('w1')].urls).toEqual([web('w1')]);
    expect(made[web('w2')].urls).toEqual([STUB, web('w2')]);
  });

  test('Switch, Window 1 incognito, nothing pinned, On: Window 2 gets the stub, Window 1 none', async () => {
    handle = setupChromeFake(seed({ incognitoAllowed: true }));
    await restoreSession(incognitoRequest([true, false], true, true));
    const made = await byWindow();
    expect(made[web('w1')].urls).toEqual([web('w1')]);
    expect(made[web('w2')].urls).toEqual([STUB, web('w2')]);
    expect(handle.removedWindowIds).toEqual([1]);
  });

  test('Switch, Window 1 saved incognito but not allowed: as today, carried into Window 1', async () => {
    handle = setupChromeFake(pinnedFullView(false));
    await restoreSession(incognitoRequest([true, false], true, true));
    const made = await byWindow();
    expect(made[web('w1')]).toEqual({
      incognito: false,
      urls: [FULL, web('w1')],
    });
    expect(made[web('w2')].urls).toEqual([STUB, web('w2')]);
  });
});
