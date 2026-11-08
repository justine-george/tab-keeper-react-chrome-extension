import { afterEach, describe, expect, test, vi } from 'vitest';

import { restoreSession } from '../../../utils/functions/restoreSession';
import { addPinnedStub } from '../../../utils/functions/pinnedTabKeeper';
import {
  RESTORE_SESSION_MESSAGE,
  type RestoreSessionRequest,
  type WindowSpec,
} from '../../../utils/functions/windows';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// KAN-893. A drop's undo needs the windows and tabs a restore made.
const STUB = 'chrome-extension://faketestid/pinned.html';
const web = (name: string) => `https://${name}.test/`;

let handle: ChromeFakeHandle | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const spec = (names: string[]): WindowSpec => ({
  tabs: names.map((name) => ({
    tabId: name,
    favicon: '',
    title: name,
    url: web(name),
  })),
  focused: true,
  bounds: null,
});

const request = (
  specs: WindowSpec[],
  pinTabKeeper: boolean,
  extra: Partial<RestoreSessionRequest> = {}
): RestoreSessionRequest => ({
  type: RESTORE_SESSION_MESSAGE,
  specs,
  goToURLText: 'Visit Site',
  closeOtherWindows: false,
  pinTabKeeper,
  ...extra,
});

const seed = (extra: ChromeSeed = {}): ChromeSeed => ({
  windows: [
    { id: 1, focused: true, tabs: [{ id: 10, url: web('old'), active: true }] },
  ],
  ...extra,
});

const strip = async (windowId: number) =>
  (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);

describe('restoreSession answers what it made', () => {
  test('one window of three tabs with the stub: its id, the tabs in order, the stub apart', async () => {
    handle = setupChromeFake(seed());
    const made = await restoreSession(request([spec(['a', 'b', 'c'])], true));
    expect(made).toHaveLength(1);
    const [win] = made;
    const tabs = await strip(win.windowId);
    expect(tabs.map((t) => t.url)).toEqual([
      STUB,
      web('a'),
      expect.any(String),
      expect.any(String),
    ]);
    expect(win.stubTabId).toBe(tabs[0].id);
    expect(win.tabIds).toEqual(tabs.slice(1).map((t) => t.id));
  });

  test('without the stub: stubTabId is null and every tab is the restore’s', async () => {
    handle = setupChromeFake(seed());
    const [win] = await restoreSession(request([spec(['a', 'b'])], false));
    expect(win.stubTabId).toBeNull();
    expect(win.tabIds).toEqual((await strip(win.windowId)).map((t) => t.id));
  });

  test('a window Chrome refuses is left out', async () => {
    handle = setupChromeFake(seed({ refusedUrls: [web('x')] }));
    const made = await restoreSession(
      request([spec(['x']), spec(['a'])], false)
    );
    expect(made).toHaveLength(1);
    expect((await strip(made[0].windowId)).map((t) => t.url)).toEqual([
      web('a'),
    ]);
  });
});

describe('addPinnedStub', () => {
  test('answers the stub’s id', async () => {
    handle = setupChromeFake(seed());
    const id = await addPinnedStub(1);
    const [first] = await strip(1);
    expect(first.url).toBe(STUB);
    expect(id).toBe(first.id);
  });

  test('null in an incognito window, where it adds none', async () => {
    handle = setupChromeFake({
      incognitoAllowed: true,
      windows: [
        { id: 1, incognito: true, tabs: [{ id: 10, url: web('old') }] },
      ],
    });
    expect(await addPinnedStub(1)).toBeNull();
    expect((await strip(1)).map((t) => t.url)).toEqual([web('old')]);
  });
});

describe('the worker', () => {
  const ask = async (message: RestoreSessionRequest) => {
    vi.resetModules();
    await import('../../../background');
    return chrome.runtime.sendMessage(message) as Promise<unknown>;
  };

  test('answers the made windows when asked to', async () => {
    handle = setupChromeFake(seed({ action: {} }));
    const answer = await ask(request([spec(['a'])], false, { answers: true }));
    const made = (await chrome.windows.getAll()).find((w) => w.id !== 1);
    const tabs = await strip(made?.id ?? -1);
    expect(answer).toEqual([
      { windowId: made?.id, tabIds: tabs.map((t) => t.id), stubTabId: null },
    ]);
  });

  test('stays silent without the flag, as every Open does', async () => {
    handle = setupChromeFake(seed({ action: {} }));
    const answer = await ask(request([spec(['a'])], false));
    expect(answer).toBeUndefined();
  });

  test('a restore that throws answers an empty list, never silence', async () => {
    handle = setupChromeFake(seed({ action: {} }));
    vi.spyOn(chrome.windows, 'getAll').mockRejectedValue(new Error('boom'));
    const answer = await ask(
      request([spec(['a'])], false, { answers: true, closeOtherWindows: true })
    );
    expect(answer).toEqual([]);
  });
});
