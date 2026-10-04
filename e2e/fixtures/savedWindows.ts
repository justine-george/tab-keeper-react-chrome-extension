import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect } from './extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './seed';
import type {
  TabMasterContainer,
  chromeTabGroupData,
  tabContainerData,
  windowGroupData,
} from '../../src/redux/slices/tabContainerDataStateSlice';
import { isValidTabMasterContainer } from '../../src/utils/functions/local';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
  type ThemeColors,
} from '../../src/hooks/useThemeColors';

// A saved session's window rows, as the popup and the tab view draw them (KAN-394).

export const POPUP = { width: 790, height: 550 };
export const TAB_VIEW = { width: 1280, height: 800 };
export const VIEWS = ['popup', 'tab view'] as const;
export type View = (typeof VIEWS)[number];

export const THEMES: [string, ThemeColors][] = [
  ['Light', LIGHT_THEME],
  ['WarmLight', WARM_LIGHT_THEME],
  ['BBPink', BB_PINK_THEME],
  ['Darkenheimer', DARKENHEIMER_THEME],
  ['Blue', BLUE_THEME],
];

export const NAMED = 'Reading list';
export const AUTO_SCROLL_BAND = 48;

// A window of `tabs` tabs, `${id}-t<i>`, each at https://<id>-<i>.test/.
export const savedWindow = (
  id: string,
  title: string,
  tabs = 1,
  bounds = { width: 1920, height: 1080 }
): windowGroupData => ({
  windowId: id,
  windowHeight: bounds.height,
  windowWidth: bounds.width,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs,
  title,
  tabs: Array.from({ length: tabs }, (_, i) => ({
    tabId: `${id}-t${i}`,
    favicon: '',
    title: `Page ${id}.${i}`,
    url: `https://${id}-${i}.test/`,
  })),
});

// One Chrome group per entry, `perGroup` tabs `${groupId}-t<i>` titled `Page ${groupId}.<i>` at https://<groupId>-<i>.test/ (needs grantedTest).
export const groupedWindow = (
  id: string,
  title: string,
  groups: chromeTabGroupData[],
  perGroup = 2,
  bounds = { width: 1920, height: 1080 }
): windowGroupData => {
  const tabs = groups.flatMap((g) =>
    Array.from({ length: perGroup }, (_, i) => ({
      tabId: `${g.groupId}-t${i}`,
      favicon: '',
      title: `Page ${g.groupId}.${i}`,
      url: `https://${g.groupId}-${i}.test/`,
      chromeGroupId: g.groupId,
    }))
  );
  return {
    windowId: id,
    windowHeight: bounds.height,
    windowWidth: bounds.width,
    windowOffsetTop: 0,
    windowOffsetLeft: 0,
    tabCount: tabs.length,
    title,
    tabs,
    chromeTabGroups: groups,
  };
};

export const session = (
  id: string,
  title: string,
  windows: windowGroupData[]
): tabContainerData =>
  buildSession({
    tabGroupId: id,
    title,
    windowCount: windows.length,
    tabCount: windows.reduce((n, w) => n + w.tabs.length, 0),
    windows,
  });

// Opens the view with `selected` shown and the pointer parked at (0, 0).
export async function openSaved(
  context: BrowserContext,
  extensionId: string,
  view: View,
  {
    sessions,
    selected = 'S1',
    settings = {},
  }: {
    sessions: tabContainerData[];
    selected?: string;
    settings?: Record<string, unknown>;
  }
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer(
      sessions.map((s) => ({ ...s, isSelected: s.tabGroupId === selected }))
    ),
    selectedTabGroupId: selected,
  });
  // One seed, and only when there is one: a later seedSettings replaces an earlier.
  const seeded = {
    ...settings,
    ...(view === 'tab view' ? { foldSavedSessionInTabView: false } : {}),
  };
  if (Object.keys(seeded).length > 0) await seedSettings(context, seeded);
  const page = await context.newPage();
  await page.setViewportSize(view === 'popup' ? POPUP : TAB_VIEW);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${
      view === 'tab view' ? '?view=tab' : ''
    }`
  );
  if (view === 'tab view') {
    await page
      .locator(`[data-pane="sessions"] [data-drag-row-id="${selected}"]`)
      .click();
  }
  // goto resolves before React mounts (KAN-105).
  const first = sessions.find((s) => s.tabGroupId === selected)?.windows[0]
    ?.windowId;
  await expect(page.locator(`[data-drag-row-id="${first}"]`)).toBeVisible();
  await page.mouse.move(0, 0);
  return page;
}

export const header = (page: Page, windowId: string): Locator =>
  page.locator(
    `[data-pane="detail"] [data-drag-row-id="${windowId}"] [data-window-drag-handle]`
  );

// A group band's title row: its title, its strip, and its editor.
export const bandHandle = (page: Page, groupId: string): Locator =>
  page.locator(
    `[data-pane="detail"] [data-band-id="${groupId}"] [data-group-drag-handle]`
  );

export async function stored(page: Page): Promise<TabMasterContainer> {
  const raw = await page.evaluate(() =>
    localStorage.getItem('tabContainerData')
  );
  const parsed: unknown = JSON.parse(raw ?? 'null');
  if (!isValidTabMasterContainer(parsed)) {
    throw new Error(`tabContainerData is not a container: ${raw}`);
  }
  return parsed;
}

export const storedWindowIds = async (page: Page, sessionId: string) =>
  (await stored(page)).tabGroups
    .find((g) => g.tabGroupId === sessionId)
    ?.windows.map((w) => w.windowId) ?? [];

export async function boxOf(loc: Locator) {
  const b = await loc.boundingBox();
  if (b === null) throw new Error(`no box for ${loc.toString()}`);
  return b;
}

// The saved detail's scrolling box: the window rows' nearest overflow ancestor.
export const detailPane = (page: Page) =>
  page.evaluate(() => {
    let el = document.querySelector(
      '[data-pane="detail"] [data-drop-window-id]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no detail pane');
    const b = el.getBoundingClientRect();
    return {
      left: b.left,
      top: b.top,
      bottom: b.bottom,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });
