import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load. See
// focusSavesEveryWindow.test.ts for the same pattern and why it is needed.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import {
  focusTabContainer,
  openAllTabContainer,
  openTabsInAWindow,
  restoreContainer,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { RestoreSessionRequest } from '../../utils/functions/windows';
import { setupChromeFake } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';

// This is the actual safety net for KAN-11 task 6. Before this refactor, only
// focusTabContainer had any coverage (focusSavesEveryWindow.test.ts) -- a
// green suite proved nothing about "Open in new window" or "Open session",
// the two most-used buttons in the app. Each test here pins the exact
// RestoreSessionRequest a call site hands to chrome.runtime.sendMessage, so a
// future change that alters specs, closeOtherWindows, or drops the message
// entirely turns red here first.

const SESSION: TabMasterContainer = {
  lastModified: 1,
  selectedTabGroupId: null,
  tabGroups: [
    {
      tabGroupId: 'group-1',
      title: 'Two windows',
      createdTime: '2026-09-01 12:00:00',
      windowCount: 2,
      tabCount: 2,
      isAutoSave: false,
      isSelected: false,
      windows: [
        {
          windowId: 'w-a',
          windowHeight: 700,
          windowWidth: 900,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'A',
          tabs: [
            {
              tabId: 't-a',
              favicon: '',
              title: 'A',
              url: 'https://a.example/',
            },
          ],
        },
        {
          windowId: 'w-b',
          windowHeight: 700,
          windowWidth: 900,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'B',
          tabs: [
            {
              tabId: 't-b',
              favicon: '',
              title: 'B',
              url: 'https://b.example/',
            },
          ],
        },
      ],
    },
  ],
};

const GO_TO_URL_TEXT = 'Go to URL';

function firstSentRequest(
  handle: ReturnType<typeof setupChromeFake>
): RestoreSessionRequest {
  expect(handle.sentMessages).toHaveLength(1);
  return handle.sentMessages[0] as RestoreSessionRequest;
}

describe('every restore call site posts one RestoreSessionRequest to the worker', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  beforeEach(() => {
    handle?.restore();
    handle = undefined;
  });

  it('openTabsInAWindow ("Open in new window") sends exactly 1 spec for the requested window, closeOtherWindows false', async () => {
    handle = setupChromeFake();

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(SESSION));
    await store.dispatch(
      openTabsInAWindow({
        tabGroupId: 'group-1',
        windowId: 'w-b',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = firstSentRequest(handle);
    expect(request.closeOtherWindows).toBe(false);
    expect(request.specs).toHaveLength(1);
    expect(request.specs[0].focused).toBe(true);
    expect(request.specs[0].tabs.map((t) => t.url)).toEqual([
      'https://b.example/',
    ]);
  });

  it('openAllTabContainer ("Open session") sends one spec per window, closeOtherWindows false', async () => {
    handle = setupChromeFake();

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(SESSION));
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = firstSentRequest(handle);
    expect(request.closeOtherWindows).toBe(false);
    expect(request.specs).toHaveLength(2);
    expect(request.specs[0].focused).toBe(true);
    expect(request.specs[1].focused).toBe(false);
    expect(request.specs.map((s) => s.tabs[0].url)).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
  });

  it('focusTabContainer (focus mode) sends one spec per window, closeOtherWindows true', async () => {
    // A window open before the switch, distinct from SESSION's windows, so
    // captureOpenWindows has something to capture -- mirrors
    // focusSavesEveryWindow.test.ts's fixture.
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: 'https://open.example/', title: 'Open' },
          ] as chrome.tabs.Tab[],
        },
      ],
    });

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(SESSION));
    await store.dispatch(
      focusTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
        saveTitle: 'Auto-saved before switching',
      })
    );

    const request = firstSentRequest(handle);
    expect(request.closeOtherWindows).toBe(true);
    expect(request.specs).toHaveLength(2);
    expect(request.specs[0].focused).toBe(true);
    expect(request.specs[1].focused).toBe(false);
    expect(request.specs.map((s) => s.tabs[0].url)).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
  });
});
