import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-698. A double-click on a button that saves or opens acts once. Before,
// each click acted: Currently open's row Save made two identical sessions, and
// a saved row's Open opened the window twice. Measured on main before the fix:
// row Save 0 -> 2 sessions, row Open 1 -> 3 Chrome windows (one click 1 -> 2),
// header Save 0 -> 2, the session header's Open 1 -> 3.

const sessionCount = (page: Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('tabContainerData') ?? '{}') as {
          tabGroups?: unknown[];
        }
      ).tabGroups?.length ?? 0
  );

test.describe('Currently open: a window row Save', () => {
  for (const how of [
    'a double-click',
    'CONTROL: two separate clicks',
  ] as const) {
    test(`${how} saves ${how === 'a double-click' ? 'one session' : 'two'}`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await serviceWorker.evaluate(() =>
        chrome.windows.create({
          focused: false,
          url: [
            'data:text/html,<title>Probe one</title>',
            'data:text/html,<title>Probe two</title>',
          ],
        })
      );
      const page = await context.newPage();
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
      await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
      const save = page
        .locator('[data-pane="open-now"]')
        .getByRole('button', { name: /^Save window as a session: / })
        .last();
      await save.hover();
      const before = await sessionCount(page);
      if (how === 'a double-click') {
        await save.dblclick();
      } else {
        await save.click();
        await expect.poll(() => sessionCount(page)).toBe(before + 1);
        // Past any double-click interval: a fresh press.
        await page.waitForTimeout(700);
        await save.hover();
        await save.click();
      }
      const expected = before + (how === 'a double-click' ? 1 : 2);
      await expect.poll(() => sessionCount(page)).toBe(expected);
      // And no late second save.
      await page.waitForTimeout(1000);
      expect(await sessionCount(page)).toBe(expected);
    });
  }
});

test.describe('a saved window row Open', () => {
  for (const how of ['a double-click', 'CONTROL: Enter'] as const) {
    test(`${how} opens the window once`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await seedSessions(context, {
        ...buildContainer([
          buildSession({
            tabGroupId: 's1',
            title: 'Trip',
            isSelected: true,
            windowCount: 1,
            tabCount: 2,
            windows: [
              {
                windowId: 'w1',
                windowHeight: 800,
                windowWidth: 1200,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 2,
                title: 'Planning',
                tabs: ['One', 'Two'].map((title, i) => ({
                  tabId: `t${i}`,
                  favicon: '',
                  title,
                  url: `data:text/html,<title>${title}</title>`,
                })),
              },
            ],
          }),
        ]),
        selectedTabGroupId: 's1',
      });
      const page = await context.newPage();
      await page.setViewportSize({ width: 790, height: 550 });
      await page.goto(`chrome-extension://${extensionId}/index.html`);
      await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
      const windows = () =>
        serviceWorker.evaluate(
          async () => (await chrome.windows.getAll()).length
        );
      const open = page
        .locator('[data-pane="detail"] [data-drag-row-id="w1"]')
        .getByRole('button', { name: /^Open/ })
        .first();
      await open.hover();
      const before = await windows();
      if (how === 'a double-click') await open.dblclick();
      else {
        await open.focus();
        await page.keyboard.press('Enter');
      }
      await expect.poll(windows).toBe(before + 1);
      // And no second window after a wait.
      await page.waitForTimeout(1500);
      expect(await windows()).toBe(before + 1);
    });
  }
});

// ---- The other buttons that save or open --------------------------------------

const TRIP = buildSession({
  tabGroupId: 's1',
  title: 'Trip',
  isSelected: true,
  windowCount: 1,
  tabCount: 1,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 800,
      windowWidth: 1200,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Planning',
      tabs: [
        {
          tabId: 't0',
          favicon: '',
          title: 'One',
          url: 'data:text/html,<title>One</title>',
        },
      ],
    },
  ],
});

type Counted = 'sessions' | 'windows';
const cases: {
  name: string;
  view: 'popup' | 'tab';
  counts: Counted;
  button: (page: Page) => ReturnType<Page['locator']>;
}[] = [
  {
    name: "the header's Save",
    view: 'popup',
    counts: 'sessions',
    button: (page) =>
      page
        .getByRole('button', {
          name: /^Save (all open windows|current window) as a session$/,
        })
        .first(),
  },
  {
    name: "Currently open's Save all",
    view: 'tab',
    counts: 'sessions',
    button: (page) =>
      page
        .locator('[data-pane="open-now"]')
        .getByRole('button', { name: 'Save all open windows as a session' }),
  },
  {
    name: "Currently open's Save current window",
    view: 'tab',
    counts: 'sessions',
    button: (page) =>
      page
        .locator('[data-pane="open-now"]')
        .getByRole('button', { name: 'Save current window as a session' }),
  },
  {
    name: "the session header's Open",
    view: 'popup',
    counts: 'windows',
    button: (page) =>
      page.locator('[aria-label="Open session, keeping current windows"]'),
  },
  {
    name: "a session row's Open",
    view: 'popup',
    counts: 'windows',
    button: (page) =>
      page
        .locator('[data-pane="sessions"]')
        .getByRole('button', { name: 'Open', exact: true }),
  },
];

for (const c of cases) {
  test(`a double-click on ${c.name} acts once`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSessions(context, {
      ...buildContainer([TRIP]),
      selectedTabGroupId: 's1',
    });
    const page = await context.newPage();
    await page.setViewportSize(
      c.view === 'popup'
        ? { width: 790, height: 550 }
        : { width: 1400, height: 900 }
    );
    await page.goto(
      `chrome-extension://${extensionId}/index.html${
        c.view === 'tab' ? '?view=tab' : ''
      }`
    );
    await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
    const count = () =>
      c.counts === 'sessions'
        ? sessionCount(page)
        : serviceWorker.evaluate(
            async () => (await chrome.windows.getAll()).length
          );
    const button = c.button(page);
    await button.hover();
    const before = await count();
    await button.dblclick();
    await expect.poll(count).toBe(before + 1);
    // And no second one after a wait.
    await page.waitForTimeout(1500);
    expect(await count()).toBe(before + 1);
  });
}
