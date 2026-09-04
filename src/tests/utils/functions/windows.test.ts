import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createWindowWithRetries,
  isRestoreSessionRequest,
  planWindowClosure,
  RESTORE_SESSION_MESSAGE,
  WindowSpec,
} from '../../../utils/functions/windows';
import { setupChromeFake } from '../../setup/chrome.fake';

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
  let nextTabId = 100;

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
      // createWindowWithRetries awaits this callback to learn the created
      // tab's id, so a fake that never called back would hang the promise it
      // is building rather than fail a single assertion.
      create: (
        options: chrome.tabs.CreateProperties,
        callback?: (tab?: chrome.tabs.Tab) => void
      ) => {
        createdTabs.push(options);
        callback?.({ id: nextTabId++ } as chrome.tabs.Tab);
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

describe('createWindowWithRetries with tab groups', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  test('groups the right tabs and applies title and colour', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });

    await createWindowWithRetries(
      spec({
        tabs: [
          { ...tab('https://a.test'), tabId: 't1', chromeGroupId: 'g1' },
          { ...tab('https://b.test'), tabId: 't2', chromeGroupId: 'g1' },
          { ...tab('https://c.test'), tabId: 't3' },
        ],
        groups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
      }),
      'Go',
      false,
      2
    );

    expect(handle.groupedTabs).toHaveLength(1);
    expect(handle.groupedTabs[0].tabIds).toHaveLength(2);

    const groups = await chrome.tabGroups.query({});
    expect(groups[0]).toMatchObject({ title: 'Work', color: 'blue' });
  });

  test('an unknown colour is applied as grey rather than rejected', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });

    await createWindowWithRetries(
      spec({
        tabs: [{ ...tab('https://a.test'), tabId: 't1', chromeGroupId: 'g1' }],
        groups: [{ groupId: 'g1', title: 'Work', color: 'chartreuse' }],
      }),
      'Go',
      false,
      2
    );

    const groups = await chrome.tabGroups.query({});
    expect(groups[0].color).toBe('grey');
  });

  test('does no grouping at all when the permission is absent', async () => {
    handle = setupChromeFake();
    delete (globalThis as { chrome?: { tabGroups?: unknown } }).chrome!
      .tabGroups;

    await createWindowWithRetries(
      spec({
        tabs: [{ ...tab('https://a.test'), tabId: 't1', chromeGroupId: 'g1' }],
        groups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
      }),
      'Go',
      false,
      2
    );

    expect(handle.groupedTabs).toEqual([]);
  });

  // The load-bearing failure case. By the time grouping runs the tabs are
  // already open, so a grouping error must cost the groups and nothing else --
  // above all it must still resolve with the created window, because focus
  // mode decides whether to close the user's windows from that value.
  test('a failing tabs.group still resolves with the created window', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });
    const tabs = chrome.tabs as unknown as {
      group: (options: chrome.tabs.GroupOptions) => Promise<number>;
    };
    tabs.group = () => Promise.reject(new Error('nope'));

    const created = await createWindowWithRetries(
      spec({
        tabs: [{ ...tab('https://a.test'), tabId: 't1', chromeGroupId: 'g1' }],
        groups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
      }),
      'Go',
      false,
      2
    );

    expect(created).not.toBeNull();
  });

  // The try/catch inside applyTabGroups is not only there to keep the
  // rejection from escaping createWindowWithRetries (the test above): it also
  // sits INSIDE the per-group loop, so one group failing does not abandon the
  // groups after it. This is the assertion that pins that -- a plain
  // "resolves with the window" check cannot distinguish "every group but the
  // first still got applied" from "the whole loop aborted after the first
  // failure", since both leave the window intact.
  test('a group that fails does not stop the groups after it', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });
    const tabs = chrome.tabs as unknown as {
      group: (options: chrome.tabs.GroupOptions) => Promise<number>;
    };
    const originalGroup = tabs.group;
    let calls = 0;
    tabs.group = (options) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('nope'));
      return originalGroup(options);
    };

    const created = await createWindowWithRetries(
      spec({
        tabs: [
          { ...tab('https://a.test'), tabId: 't1', chromeGroupId: 'g1' },
          { ...tab('https://b.test'), tabId: 't2', chromeGroupId: 'g2' },
        ],
        groups: [
          { groupId: 'g1', title: 'First', color: 'blue' },
          { groupId: 'g2', title: 'Second', color: 'green' },
        ],
      }),
      'Go',
      false,
      2
    );

    expect(created).not.toBeNull();
    // Only the second group's tabs.group call reaches the real fake: the
    // first was intercepted and rejected before it got there.
    expect(handle.groupedTabs).toHaveLength(1);
    const groups = await chrome.tabGroups.query({});
    expect(groups.some((group) => group.title === 'Second')).toBe(true);
  });

  test('a spec with no groups behaves exactly as before', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });

    const created = await createWindowWithRetries(spec(), 'Go', false, 2);

    expect(created).not.toBeNull();
    expect(handle.groupedTabs).toEqual([]);
  });
});

describe('isRestoreSessionRequest', () => {
  const valid = {
    type: RESTORE_SESSION_MESSAGE,
    specs: [],
    goToURLText: 'Go',
    isLazyLoad: false,
    closeOtherWindows: true,
  };

  test('accepts a well-formed request', () => {
    expect(isRestoreSessionRequest(valid)).toBe(true);
  });

  test('rejects a request missing closeOtherWindows', () => {
    const withoutFlag: Record<string, unknown> = { ...valid };
    delete withoutFlag.closeOtherWindows;
    expect(isRestoreSessionRequest(withoutFlag)).toBe(false);
  });

  test('rejects a non-boolean closeOtherWindows', () => {
    expect(
      isRestoreSessionRequest({ ...valid, closeOtherWindows: 'yes' })
    ).toBe(false);
  });

  test('rejects the wrong type, a non-object and null', () => {
    expect(isRestoreSessionRequest({ ...valid, type: 'something' })).toBe(
      false
    );
    expect(isRestoreSessionRequest('nope')).toBe(false);
    expect(isRestoreSessionRequest(null)).toBe(false);
  });
});
