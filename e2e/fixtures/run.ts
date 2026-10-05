import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect } from './extension';
import {
  FULL,
  FULL_VIEW_PATH,
  POPUP,
  openPage,
  storedSettings,
} from './onboarding';
import { localeStrings } from './locales';
import { isValidTabMasterContainer } from '../../src/utils/functions/local';
import type { TabMasterContainer } from '../../src/redux/slices/tabContainerDataStateSlice';
import type { RunView } from '../../src/utils/functions/firstRun';

// The run's e2e helpers.

export async function storedTitles(page: Page): Promise<string[]> {
  const parsed: unknown = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tabContainerData') ?? 'null')
  );
  return isValidTabMasterContainer(parsed)
    ? parsed.tabGroups.map((g) => g.title)
    : [];
}

export interface RunViewCase {
  name: string;
  path: string;
  viewport: { width: number; height: number };
  view: RunView;
  total: number;
}
export const POPUP_RUN: RunViewCase = {
  name: 'popup',
  path: 'index.html',
  viewport: POPUP,
  view: 'popup',
  total: 7,
};
export const FULL_RUN: RunViewCase = {
  name: 'full view',
  path: FULL_VIEW_PATH,
  viewport: FULL,
  view: 'full',
  total: 8,
};
export const RUN_VIEWS: readonly RunViewCase[] = [POPUP_RUN, FULL_RUN];

export const card = (page: Page) =>
  page.locator('[data-coach-mark]:not([aria-hidden])');
export const cardAt = (page: Page, step: number) =>
  page.locator(
    `[data-coach-mark][data-coach-step="${step}"]:not([aria-hidden])`
  );
export const cardButton = (page: Page, name: string) =>
  card(page).getByRole('button', { name, exact: true });
export const cardSide = (page: Page) =>
  card(page).getAttribute('data-coach-side');
export const hello = (page: Page) => page.locator('dialog[data-run-hello]');
export const runCheck = (page: Page, outcome: string) =>
  expect(page.locator('html')).toHaveAttribute('data-run-check', outcome);

export async function storedRun(page: Page): Promise<unknown> {
  return (await storedSettings(page)).firstRun ?? null;
}

// Settings → Help → Show me around, in whichever view this page is, in the language on screen.
export async function startRunFromHelp(
  page: Page,
  say: (key: string) => string = (key) => key
): Promise<void> {
  await page
    .getByRole('button', { name: say('Settings'), exact: true })
    .click();
  await page.getByRole('button', { name: say('Help'), exact: true }).click();
  await page
    .locator('[data-help]')
    .getByRole('button', { name: say('Show me around'), exact: true })
    .click();
}

// A run from Help, on its first card.
export async function openRunFromHelp(
  context: BrowserContext,
  extensionId: string,
  view: RunViewCase
): Promise<Page> {
  const page = await openPage(context, extensionId, view.path, view.viewport);
  await startRunFromHelp(page);
  if (view.view === 'full') {
    await hello(page)
      .getByRole('button', { name: 'Start', exact: true })
      .click();
  }
  await expect(cardAt(page, 1)).toBeVisible();
  return page;
}

export async function nextTo(page: Page, step: number): Promise<void> {
  await cardButton(page, 'Next').click();
  await expect(cardAt(page, step)).toBeVisible();
}

// openRunFromHelp in another language: every name is read from the locale on screen.
export async function openRunFromHelpIn(
  context: BrowserContext,
  extensionId: string,
  view: RunViewCase,
  lang: string
): Promise<Page> {
  const say = (key: string) => localeStrings(lang)[key] ?? key;
  const page = await context.newPage();
  await page.setViewportSize(view.viewport);
  await page.goto(`chrome-extension://${extensionId}/${view.path}`);
  // Not the English "Sort sessions" label openPage waits for.
  await page.locator('[data-pane="sessions"]').waitFor();
  await startRunFromHelp(page, say);
  if (view.view === 'full') {
    await hello(page)
      .getByRole('button', { name: say('Start'), exact: true })
      .click();
  }
  await expect(cardAt(page, 1)).toBeVisible();
  return page;
}

// What a pointer at (x, y) lands on first: the dim, the still box, or the element's own markup.
export const hitAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) => {
      const top = document.elementFromPoint(x, y);
      if (top === null) return 'nothing';
      if (top.hasAttribute('data-coach-dim')) return 'dim';
      if (top.hasAttribute('data-coach-still')) return 'still';
      return top.outerHTML.slice(0, 120);
    },
    [x, y]
  );

export async function centreOf(locator: Locator): Promise<[number, number]> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not drawn');
  return [box.x + box.width / 2, box.y + box.height / 2];
}

// Written only while nothing is stored, in the top frame: a reload keeps what the page wrote.
export async function seedSessionsIfAbsent(
  context: BrowserContext,
  container: TabMasterContainer
): Promise<void> {
  await context.addInitScript((value: string) => {
    if (window.top !== window) return;
    try {
      if (localStorage.getItem('tabContainerData') === null) {
        localStorage.setItem('tabContainerData', value);
      }
    } catch {
      // Storage blocked; the specs' own assertions say so more clearly.
    }
  }, JSON.stringify(container));
}

// A persona's settings as given, nothing merged: use with test.use({ freshProfile: true }).
export async function seedRawSettingsIfAbsent(
  context: BrowserContext,
  settings: Record<string, unknown>
): Promise<void> {
  await context.addInitScript((value: string) => {
    if (window.top !== window) return;
    try {
      if (localStorage.getItem('settingsData') === null) {
        localStorage.setItem('settingsData', value);
      }
    } catch {
      // Storage blocked; the specs' own assertions say so more clearly.
    }
  }, JSON.stringify(settings));
}
