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
}));

import {
  mergeSessionsFromBackupInternal,
  replaceState,
  restoreContainer,
  saveToTabContainerInternal,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { toStoredTab } from '../../utils/functions/capture';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { buildChromeTab } from '../fixtures/chromeTab';

// KAN-594. Chrome's favicon cache draws a visited page's icon, embedded ones
// included, so a stored tab never keeps a data: favicon: 5-20 KB each, in a
// localStorage of 5,241,856 characters.

const EMBEDDED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';
const REMOTE = 'https://example.com/favicon.ico';

const withFavicons = (
  tabGroupId: string,
  favicons: string[],
  overrides: Partial<tabContainerData> = {}
): tabContainerData => {
  const base = buildSession({ tabGroupId, ...overrides });
  return {
    ...base,
    tabCount: favicons.length,
    windows: [
      {
        ...base.windows[0],
        tabCount: favicons.length,
        tabs: favicons.map((favicon, i) => ({
          tabId: `${tabGroupId}-t${i}`,
          favicon,
          title: `Tab ${i}`,
          url: `https://t${i}.test/`,
        })),
      },
    ],
  };
};

const faviconsOf = (c: TabMasterContainer) =>
  c.tabGroups.map((g) =>
    g.windows.flatMap((w) => w.tabs.map((t) => t.favicon))
  );

const stored = () =>
  JSON.parse(
    localStorage.getItem('tabContainerData') ?? 'null'
  ) as TabMasterContainer;

describe('a stored tab never keeps an embedded favicon (KAN-594)', () => {
  beforeEach(() => localStorage.clear());

  it('a captured tab drops an embedded favicon and keeps a remote one', () => {
    expect(toStoredTab(buildChromeTab({ favIconUrl: EMBEDDED })).favicon).toBe(
      ''
    );
    expect(toStoredTab(buildChromeTab({ favIconUrl: REMOTE })).favicon).toBe(
      REMOTE
    );
  });

  it('a container loaded into the page (startup, sync) is stripped, in the page and in localStorage', () => {
    const { store } = makeTestStore();
    store.dispatch(
      replaceState(buildContainer([withFavicons('s1', [EMBEDDED, REMOTE, ''])]))
    );
    expect(faviconsOf(store.getState().tabContainerDataState)).toEqual([
      ['', REMOTE, ''],
    ]);
    expect(faviconsOf(stored())).toEqual([['', REMOTE, '']]);
  });

  it('Replace from a backup strips it, and an unchanged session keeps its timestamp', () => {
    const { store } = makeTestStore();
    store.dispatch(
      replaceState(buildContainer([withFavicons('s1', [EMBEDDED, REMOTE])]))
    );
    const before =
      store.getState().tabContainerDataState.tabGroups[0].lastModified;

    // The same session as the backup holds it: the icon Chrome embedded, unstripped.
    store.dispatch(
      restoreContainer(buildContainer([withFavicons('s1', [EMBEDDED, REMOTE])]))
    );
    const after = store.getState().tabContainerDataState;
    expect(faviconsOf(after)).toEqual([['', REMOTE]]);
    expect(after.tabGroups[0].lastModified).toBe(before);
    expect(faviconsOf(stored())).toEqual([['', REMOTE]]);
  });

  it('Merge from a backup strips the sessions it adds', () => {
    const { store } = makeTestStore();
    store.dispatch(saveToTabContainerInternal(withFavicons('here', [REMOTE])));
    store.dispatch(
      mergeSessionsFromBackupInternal(
        buildContainer([withFavicons('file', [EMBEDDED, REMOTE])])
      )
    );
    const byId = Object.fromEntries(
      store
        .getState()
        .tabContainerDataState.tabGroups.map((g) => [
          g.tabGroupId,
          g.windows[0].tabs.map((t) => t.favicon),
        ])
    );
    expect(byId).toEqual({ file: ['', REMOTE], here: [REMOTE] });
    expect(faviconsOf(stored()).flat()).not.toContain(EMBEDDED);
  });
});
