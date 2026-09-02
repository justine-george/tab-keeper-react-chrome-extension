import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
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
  restoreContainer,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setupChromeFake } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';

const PARAMS = {
  tabGroupId: 'group-1',
  goToURLText: 'Go to URL',
  saveTitle: 'Auto-saved before switching',
};

// The session focus mode switches TO. Its window is deliberately unlike
// anything open, so isAlreadySaved cannot suppress the save under test.
const TARGET: TabMasterContainer = {
  lastModified: 1,
  selectedTabGroupId: null,
  tabGroups: [
    {
      tabGroupId: 'group-1',
      title: 'Somewhere else',
      createdTime: '2026-09-01 12:00:00',
      windowCount: 1,
      tabCount: 1,
      isAutoSave: false,
      isSelected: false,
      windows: [
        {
          windowId: 'w-z',
          windowHeight: 700,
          windowWidth: 900,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'Z',
          tabs: [
            {
              tabId: 't-z',
              favicon: '',
              title: 'Z',
              url: 'https://z.example/',
            },
          ],
        },
      ],
    },
  ],
};

// KAN-5 gave captureOpenWindows a scope so the save row can offer "just this
// window". Focus mode saves through that same function and then hands off to
// background.ts, which closes EVERY normal window unconditionally. So the two
// focus-mode call sites must stay at 'all-windows' forever: a scope narrower
// than what gets closed means windows are closed that were never saved, and
// the tabs in them are gone.
//
// This is a regression guard, so it passed the moment it was written. Its
// teeth were shown by mutation instead -- flipping either focus-mode call site
// to 'current-window' turns it red.
describe('focus mode saves every window it is about to close (KAN-5)', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  beforeEach(() => {
    handle?.restore();
    handle = undefined;
  });

  // The fake answers windows.getCurrent with the first seeded window, so a
  // 'current-window' capture here would keep only the A window -- and the two
  // whose tabs would be lost are exactly B and C.
  const seedThreeOpenWindows = () =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: 'https://a.example/', title: 'A' },
          ] as chrome.tabs.Tab[],
        },
        {
          id: 2,
          tabs: [
            { id: 2, url: 'https://b.example/', title: 'B' },
          ] as chrome.tabs.Tab[],
        },
        {
          id: 3,
          tabs: [
            { id: 3, url: 'https://c.example/', title: 'C' },
          ] as chrome.tabs.Tab[],
        },
      ],
    });

  it('saves all three open windows, not just the current one', async () => {
    handle = seedThreeOpenWindows();

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(TARGET));
    await store.dispatch(focusTabContainer(PARAMS));

    const { tabGroups } = store.getState().tabContainerDataState;

    // Newly saved sessions are unshifted, so the save under test is first.
    expect(tabGroups).toHaveLength(2);
    const saved = tabGroups[0];
    expect(saved.title).toBe(PARAMS.saveTitle);
    expect(saved.windows).toHaveLength(3);
    expect(saved.windows.map((w) => w.tabs[0].url).sort()).toEqual([
      'https://a.example/',
      'https://b.example/',
      'https://c.example/',
    ]);
  });

  // The other half of the contract: what was saved has to cover what the
  // worker is told to close. background.ts closes every normal window, so the
  // count it will act on is the count that must have been captured.
  it('hands off to the worker only after that save', async () => {
    handle = seedThreeOpenWindows();

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(TARGET));
    await store.dispatch(focusTabContainer(PARAMS));

    const { tabGroups } = store.getState().tabContainerDataState;
    const savedWindowCount = tabGroups[0].windows.length;

    expect(handle.sentMessages).toHaveLength(1);
    expect(savedWindowCount).toBe(3);
  });
});
