import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import {
  focusTabContainer,
  requestFocusTabContainer,
  restoreContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setSkipDuplicateTabs } from '../../redux/slices/settingsDataStateSlice';
import { setupChromeFake } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';
import { buildChromeTab } from '../fixtures/chromeTab';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-906. Focus mode compares, and saves, the open windows with repeats left out.

const PARAMS = {
  tabGroupId: 'other',
  goToURLText: 'Go to URL',
  saveTitle: 'Auto-saved before switching',
};
const A = 'https://a.example/';
const B = 'https://b.example/';

const sessionOf = (tabGroupId: string, ...urls: string[]): tabContainerData => {
  const base = buildSession({ tabGroupId });
  const tabs = urls.map((url, i) => ({
    tabId: `${tabGroupId}-${i}`,
    favicon: '',
    title: `T${i}`,
    url,
  }));
  return {
    ...base,
    tabCount: tabs.length,
    windows: [{ ...base.windows[0], tabCount: tabs.length, tabs }],
  };
};

// One open window [a, a, b]; saved: [a, b] (what an On save of it stored) and a session to switch to.
const seed = (on: boolean) => {
  const handle = setupChromeFake({
    windows: [
      {
        id: 1,
        tabs: [
          buildChromeTab({ id: 1, url: A, title: 'A' }),
          buildChromeTab({ id: 2, url: A, title: 'A again' }),
          buildChromeTab({ id: 3, url: B, title: 'B' }),
        ],
      },
    ],
  });
  const { store } = makeTestStore();
  store.dispatch(setSkipDuplicateTabs(on));
  store.dispatch(
    restoreContainer(
      buildContainer([
        sessionOf('other', 'https://z.example/'),
        sessionOf('kept', A, B),
      ])
    )
  );
  return { handle, store };
};

describe('focus mode with Skip duplicate tabs (KAN-906)', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;
  beforeEach(() => {
    handle?.restore();
    handle = undefined;
  });

  it('On: [a, a, b] open matches the saved [a, b]: the dialog promises no save and nothing is saved', async () => {
    const s = seed(true);
    handle = s.handle;
    await s.store.dispatch(requestFocusTabContainer(PARAMS));
    expect(s.store.getState().globalState.focusRequest?.willSave).toBe(false);

    await s.store.dispatch(focusTabContainer(PARAMS));
    expect(s.store.getState().tabContainerDataState.tabGroups).toHaveLength(2);
  });

  it('Off: the same windows are unsaved work: the dialog promises a save and one is made', async () => {
    const s = seed(false);
    handle = s.handle;
    await s.store.dispatch(requestFocusTabContainer(PARAMS));
    expect(s.store.getState().globalState.focusRequest?.willSave).toBe(true);

    await s.store.dispatch(focusTabContainer(PARAMS));
    const { tabGroups } = s.store.getState().tabContainerDataState;
    expect(tabGroups).toHaveLength(3);
    expect(tabGroups[0].windows[0].tabs.map((t) => t.url)).toEqual([A, A, B]);
  });

  it('On, open windows not saved yet: what is saved has the repeats left out', async () => {
    const s = seed(true);
    handle = s.handle;
    s.store.dispatch(
      restoreContainer(
        buildContainer([sessionOf('other', 'https://z.example/')])
      )
    );
    await s.store.dispatch(focusTabContainer(PARAMS));
    const { tabGroups } = s.store.getState().tabContainerDataState;
    expect(tabGroups).toHaveLength(2);
    expect(tabGroups[0].windows[0].tabs.map((t) => t.url)).toEqual([A, B]);
    expect(tabGroups[0].tabCount).toBe(2);
  });
});
