import { afterEach, describe, expect, test } from 'vitest';

import {
  captureOpenWindows,
  isAlreadySaved,
} from '../../../utils/functions/capture';
import { setupChromeFake } from '../../setup/chrome.fake';
import type {
  tabContainerData,
  windowGroupData,
} from '../../../redux/slices/tabContainerDataStateSlice';

function windowOf(...urls: string[]): windowGroupData {
  return {
    windowId: 'w',
    windowHeight: 700,
    windowWidth: 900,
    windowOffsetTop: 0,
    windowOffsetLeft: 0,
    tabCount: urls.length,
    title: 'a window',
    tabs: urls.map((url, index) => ({
      tabId: `t${index}`,
      favicon: '',
      title: url,
      url,
    })),
  };
}

function sessionOf(...windows: windowGroupData[]): tabContainerData {
  return {
    tabGroupId: 'g',
    title: 'a session',
    createdTime: '2026-08-31 12:00:00',
    windowCount: windows.length,
    tabCount: windows.reduce((total, w) => total + w.tabs.length, 0),
    isAutoSave: false,
    isSelected: false,
    windows,
  };
}

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';

describe('isAlreadySaved', () => {
  test('recognises the session the windows were restored from', () => {
    const captured = sessionOf(windowOf(A, B), windowOf(C));
    const saved = sessionOf(windowOf(A, B), windowOf(C));

    expect(isAlreadySaved(captured, [saved])).toBe(true);
  });

  test('ignores window order, which chrome.windows.getAll does not promise', () => {
    const captured = sessionOf(windowOf(C), windowOf(A, B));
    const saved = sessionOf(windowOf(A, B), windowOf(C));

    expect(isAlreadySaved(captured, [saved])).toBe(true);
  });

  test('finds the match among several saved sessions', () => {
    const captured = sessionOf(windowOf(C));

    expect(
      isAlreadySaved(captured, [sessionOf(windowOf(A)), sessionOf(windowOf(C))])
    ).toBe(true);
  });

  test('treats an extra tab as unsaved work', () => {
    const captured = sessionOf(windowOf(A, B, C));
    const saved = sessionOf(windowOf(A, B));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('treats an extra window as unsaved work', () => {
    const captured = sessionOf(windowOf(A), windowOf(B));
    const saved = sessionOf(windowOf(A));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('treats a navigated tab as unsaved work', () => {
    const captured = sessionOf(windowOf(A, C));
    const saved = sessionOf(windowOf(A, B));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('treats reordered tabs within a window as unsaved work', () => {
    const captured = sessionOf(windowOf(B, A));
    const saved = sessionOf(windowOf(A, B));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  // The dangerous near-miss: one window is stored and the other is not, so
  // treating the pair as saved would close unsaved work. Every window has to
  // match, not just one of them.
  test('treats a partial match as unsaved work', () => {
    const captured = sessionOf(windowOf(A, B), windowOf(C));
    const saved = sessionOf(
      windowOf(A, B),
      windowOf('https://elsewhere.example')
    );

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('does not let two windows add up to one saved window', () => {
    const captured = sessionOf(windowOf(A), windowOf(B));
    const saved = sessionOf(windowOf(A, B));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('does not treat a separator inside a URL as a window boundary', () => {
    const captured = sessionOf(windowOf(`${A}\n${B}`));
    const saved = sessionOf(windowOf(A, B));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('is false when nothing has been saved yet', () => {
    expect(isAlreadySaved(sessionOf(windowOf(A)), [])).toBe(false);
  });
});

// These run captureOpenWindows against the fake rather than a pure input,
// because the defect they guard was in the seam between the two: the fake held
// tabs in a flat list while every window reported `tabs: []`, and line 74 of
// capture.ts drops a window with no tabs. Every call still answered, so the
// only visible symptom was captureOpenWindows quietly returning null.
describe('captureOpenWindows against the chrome fake', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  test('captures a seeded window with its tabs', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: A, title: 'A' },
            { id: 2, url: B, title: 'B' },
          ] as chrome.tabs.Tab[],
        },
      ],
    });

    const captured = await captureOpenWindows('probe', 'all-windows');

    expect(captured).not.toBeNull();
    expect(captured!.windows).toHaveLength(1);
    expect(captured!.windows[0].tabs.map((tab) => tab.url)).toEqual([A, B]);
  });

  // KAN-25. A newly captured session is the one case where both timestamps are
  // written from scratch, so it is where they must agree.
  test('stamps the capture instant alongside the display string', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 1, url: A, title: 'A' }] as chrome.tabs.Tab[] },
      ],
    });

    const before = Date.now();
    const captured = await captureOpenWindows('probe', 'all-windows');

    expect(captured).not.toBeNull();
    expect(typeof captured!.createdAt).toBe('number');
    expect(captured!.createdAt!).toBeGreaterThanOrEqual(before);
    expect(captured!.createdAt!).toBeLessThanOrEqual(Date.now());
  });

  test('captures a tab added through tabs.create', async () => {
    handle = setupChromeFake({ windows: [{ id: 1 }] });

    await chrome.tabs.create({ windowId: 1, url: B });
    const captured = await captureOpenWindows('probe', 'all-windows');

    expect(captured).not.toBeNull();
    expect(captured!.windows[0].tabs.map((tab) => tab.url)).toEqual([B]);
  });

  test('captures a window opened through windows.create, first tab included', async () => {
    handle = setupChromeFake();

    const created = await new Promise<chrome.windows.Window | undefined>(
      (resolve) => chrome.windows.create({ url: A }, resolve)
    );
    await chrome.tabs.create({ windowId: created!.id, url: B });
    const captured = await captureOpenWindows('probe', 'all-windows');

    expect(captured).not.toBeNull();
    expect(captured!.windows[0].tabs.map((tab) => tab.url)).toEqual([A, B]);
  });

  // KAN-50. capture asked chrome for every window type, while focus mode's
  // close (background.ts) and count (the slice) both filter to 'normal'. So
  // focus mode saved popup windows it then left open, and the confirmation
  // undercounted what it was about to close.
  //
  // Excluding them loses nothing: the saved record has no `type` field at all
  // -- windowId, geometry, tabCount, title, tabs -- so a captured popup was
  // already reopening as an ordinary window. Confirmed in the real extension
  // before this changed: a saved popup restored with type 'normal'.
  test('excludes popup windows', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 1, url: A, title: 'A' }] as chrome.tabs.Tab[] },
        {
          id: 2,
          type: 'popup',
          tabs: [{ id: 2, url: B, title: 'B' }] as chrome.tabs.Tab[],
        },
      ],
    });

    const captured = await captureOpenWindows('probe', 'all-windows');

    expect(captured).not.toBeNull();
    expect(captured!.windows).toHaveLength(1);
    expect(captured!.windows[0].tabs.map((tab) => tab.url)).toEqual([A]);
  });

  // Filtering getAll is not sufficient on its own: capture unshifts
  // getCurrent() to put the user's focused window first, and that unshift
  // ran regardless of type. Seeding the popup first makes it the fake's
  // current window, which is the case a getAll-only filter would miss.
  test('excludes a popup even when it is the current window', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          type: 'popup',
          tabs: [{ id: 1, url: B, title: 'B' }] as chrome.tabs.Tab[],
        },
        { id: 2, tabs: [{ id: 2, url: A, title: 'A' }] as chrome.tabs.Tab[] },
      ],
    });

    const captured = await captureOpenWindows('probe', 'all-windows');

    expect(captured).not.toBeNull();
    expect(captured!.windows).toHaveLength(1);
    expect(captured!.windows[0].tabs.map((tab) => tab.url)).toEqual([A]);
  });

  // The worst path: a popup is the only thing open. Returning null is the
  // caller's cue that there is no session to save, so focus mode does not
  // promise a save it will not make.
  test('returns null when only popup windows are open', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          type: 'popup',
          tabs: [{ id: 1, url: B, title: 'B' }] as chrome.tabs.Tab[],
        },
      ],
    });

    expect(await captureOpenWindows('probe', 'all-windows')).toBeNull();
  });
});

// KAN-5. The save row offers "save every window" and "save just this one", so
// capture takes the scope rather than reading a preference of its own: focus
// mode saves through this same function immediately before background.ts
// closes every normal window, and a scope it did not ask for would make it
// close windows it never saved.
//
// Each assertion here is paired with the same seed captured at 'all-windows'.
// On its own, "captured one window" is equally consistent with the scope
// working and with the fake only ever holding one window to begin with.
describe('captureOpenWindows scope', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  // The fake answers windows.getCurrent with the first seeded window, so the
  // A window is the current one in both seeds below.
  const threeWindows = () => ({
    windows: [
      { id: 1, tabs: [{ id: 1, url: A, title: 'A' }] as chrome.tabs.Tab[] },
      { id: 2, tabs: [{ id: 2, url: B, title: 'B' }] as chrome.tabs.Tab[] },
      { id: 3, tabs: [{ id: 3, url: C, title: 'C' }] as chrome.tabs.Tab[] },
    ],
  });

  test("'current-window' captures only the current window", async () => {
    handle = setupChromeFake(threeWindows());

    const captured = await captureOpenWindows('probe', 'current-window');

    expect(captured).not.toBeNull();
    expect(captured!.windows).toHaveLength(1);
    expect(captured!.windows[0].tabs.map((tab) => tab.url)).toEqual([A]);
    expect(captured!.windowCount).toBe(1);
    expect(captured!.tabCount).toBe(1);
  });

  test("'all-windows' captures every window from that same seed", async () => {
    handle = setupChromeFake(threeWindows());

    const captured = await captureOpenWindows('probe', 'all-windows');

    expect(captured).not.toBeNull();
    expect(captured!.windows).toHaveLength(3);
    expect(captured!.windows.map((w) => w.tabs[0].url)).toEqual([A, B, C]);
  });

  // The worst path. getCurrent is deliberately unfiltered (KAN-50), so it can
  // hand back a popup -- and then there is no current window to save. Falling
  // back to every window is the one answer this must never give: the user
  // asked for one window and would get all of them, which at 'current-window'
  // is the same mistake in miniature that wiring focus mode to this scope
  // would make in full.
  test("'current-window' returns null when the current window is a popup", async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          type: 'popup',
          tabs: [{ id: 1, url: B, title: 'B' }] as chrome.tabs.Tab[],
        },
        { id: 2, tabs: [{ id: 2, url: A, title: 'A' }] as chrome.tabs.Tab[] },
      ],
    });

    expect(await captureOpenWindows('probe', 'current-window')).toBeNull();
  });

  test("'all-windows' still captures the normal window behind that popup", async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          type: 'popup',
          tabs: [{ id: 1, url: B, title: 'B' }] as chrome.tabs.Tab[],
        },
        { id: 2, tabs: [{ id: 2, url: A, title: 'A' }] as chrome.tabs.Tab[] },
      ],
    });

    const captured = await captureOpenWindows('probe', 'all-windows');

    expect(captured).not.toBeNull();
    expect(captured!.windows).toHaveLength(1);
    expect(captured!.windows[0].tabs.map((tab) => tab.url)).toEqual([A]);
  });
});
