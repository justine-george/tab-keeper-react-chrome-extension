import { afterEach, describe, expect, test } from 'vitest';

import { toOpenWindows } from '../../../utils/functions/openNow';
import type { OpenWindow } from '../../../utils/functions/openNow';
import { closeOpenTab, closeOpenWindow } from '../../../utils/functions/reopen';
import {
  isReopenPreferringHistoryRequest,
  REOPEN_PREFERRING_HISTORY_MESSAGE,
} from '../../../utils/functions/reopenRequest';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// The message Open now's page sends the service worker to reopen with
// history (KAN-280 Part D). Items here come from a real close, never built
// by hand, so every shape is one the page really sends.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
});

const url = (name: string) => `https://${name}.test/`;
const GRANTED: ChromeSeed['grantedPermissions'] = ['sessions', 'tabGroups'];
const tabViewWindow = {
  id: 1,
  focused: true,
  tabs: [
    { url: 'chrome-extension://faketestid/index.html', active: true },
    { url: url('home') },
  ],
};

async function openWindow(id: number): Promise<OpenWindow> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups = await chrome.tabGroups.query({});
  const found = toOpenWindows(all, groups, null).find((w) => w.id === id);
  if (!found) throw new Error(`no open window ${id}`);
  return found;
}

async function closeTab(windowId: number, name: string) {
  const openWin = await openWindow(windowId);
  const tab = openWin.tabs.find((t) => t.url === url(name));
  if (!tab) throw new Error(`no tab ${name}`);
  return closeOpenTab(openWin, tab);
}

async function closeWindow(windowId: number) {
  return closeOpenWindow(await openWindow(windowId));
}

describe('the request the page sends the worker (KAN-280 Part D)', () => {
  const seed: ChromeSeed = {
    grantedPermissions: GRANTED,
    windows: [
      tabViewWindow,
      {
        id: 2,
        left: 10,
        top: 20,
        width: 800,
        height: 600,
        tabs: [{ url: url('a'), active: true, groupId: 50 }, { url: url('b') }],
      },
    ],
    tabGroups: [{ id: 50, windowId: 2, title: 'Kyoto', color: 'blue' }],
  };

  // What arrives in the worker is a structured clone of what was sent.
  const asReceived = (value: unknown): unknown => structuredClone(value);

  test('accepts a real tab item and a real window item as they arrive', async () => {
    handle = setupChromeFake(seed);
    const tab = await closeTab(2, 'b');
    const win = await closeWindow(2);

    for (const item of [tab, win]) {
      expect(
        isReopenPreferringHistoryRequest(
          asReceived({
            type: REOPEN_PREFERRING_HISTORY_MESSAGE,
            item,
            pinTabKeeper: false,
          })
        )
      ).toBe(true);
    }
  });

  test('rejects anything malformed', async () => {
    handle = setupChromeFake(seed);
    const item = await closeTab(2, 'b');
    if (item?.kind !== 'tab') throw new Error('close failed');
    const type = REOPEN_PREFERRING_HISTORY_MESSAGE;
    const base = { type, pinTabKeeper: false };

    for (const message of [
      null,
      undefined,
      'reopenPreferringHistory',
      { type },
      { type, item },
      { type, item, pinTabKeeper: 'yes' },
      { type: 'restoreSession', item },
      { ...base, item: null },
      { ...base, item: { ...item, kind: 'group' } },
      { ...base, item: { ...item, restorableSessionId: 7 } },
      { ...base, item: { ...item, tab: undefined } },
      { ...base, item: { ...item, tab: { ...item.tab, index: '2' } } },
      { ...base, item: { ...item, tab: { ...item.tab, url: 1 } } },
      { ...base, item: { ...item, group: 'none' } },
      { ...base, item: { ...item, window: { ...item.window, tabs: 'x' } } },
      { ...base, item: { ...item, window: { ...item.window, groups: {} } } },
      { ...base, item: { ...item, window: { ...item.window, id: '2' } } },
      {
        ...base,
        item: { ...item, window: { ...item.window, tabs: [{ url: 'x' }] } },
      },
    ]) {
      expect(isReopenPreferringHistoryRequest(asReceived(message))).toBe(false);
    }
  });
});
