import type { Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { elementLanded } from './fixtures/landed';

// KAN-698. A double-click on a button that saves or opens acts once. Before,
// each click acted: Currently open's row Save made two identical sessions, and
// a saved row's Open opened the window twice. Measured on main before the fix:
// row Save 0 -> 2 sessions, row Open 1 -> 3 Chrome windows (one click 1 -> 2),
// header Save 0 -> 2, the session header's Open 1 -> 3.
// The session header's Replace replaced twice: two ⌘Z steps for one press.

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

// One Undo after a double-click on Replace brings the session back: a second
// replace would leave a second step, and the first Undo would undo only that.
test("a double-click on the session header's Replace is one Undo step", async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, {
    ...buildContainer([TRIP]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  const tabsOfTrip = () =>
    page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('tabContainerData') ?? '{}') as {
            tabGroups?: {
              tabGroupId: string;
              windows: { tabs: { title: string }[] }[];
            }[];
          }
        ).tabGroups
          ?.find((g) => g.tabGroupId === 's1')
          ?.windows.flatMap((w) => w.tabs.map((t) => t.title)) ?? []
    );
  expect(await tabsOfTrip()).toEqual(['One']);
  await page
    .locator('[aria-label="Replace this session with open windows"]')
    .first()
    .dblclick();
  // PREMISE: replaced by the open windows.
  await expect.poll(tabsOfTrip).not.toEqual(['One']);
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(tabsOfTrip).toEqual(['One']);
});

// ---- The double-click that draws a row's actions (KAN-839) ---------------------

const KYOTO = buildSession({
  tabGroupId: 's2',
  title: 'Kyoto',
  windowCount: 1,
  tabCount: 1,
  windows: TRIP.windows,
});

// What a press would change: the sessions' tabs. Selection is not one of them.
const savedTabs = (page: Page) =>
  page.evaluate(() =>
    (
      JSON.parse(localStorage.getItem('tabContainerData') ?? '{}') as {
        tabGroups?: {
          title: string;
          windows: { tabs: { title: string }[] }[];
        }[];
      }
    ).tabGroups?.map(
      (g) =>
        `${g.title}: ${g.windows.flatMap((w) => w.tabs.map((t) => t.title))}`
    )
  );

// Its second click only, so it can wait for the strip the first click drew: the
// real interval is too short to read what is under the pointer in between.
async function secondClickAt(page: Page, x: number, y: number) {
  await page.evaluate(() =>
    document.addEventListener(
      'click',
      (e) => {
        const button =
          e.target instanceof Element
            ? e.target.closest('[data-row-actions] > *')
            : null;
        document.documentElement.dataset.secondClick = `${e.detail} ${button?.getAttribute('aria-label')}`;
      },
      { capture: true, once: true }
    )
  );
  await page.mouse.move(x, y);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  return page.evaluate(() => document.documentElement.dataset.secondClick);
}

const windowCount = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.windows.getAll()).length);

// Switch's is row-actions.spec.ts: a press there is a dialog, not a count.
for (const name of ['Open', 'Replace'] as const) {
  test(`a double-click that selects a row presses nothing of the ${name} drawn under it`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSessions(context, {
      ...buildContainer([TRIP, KYOTO]),
      selectedTabGroupId: 's1',
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    const sessions = page.locator('[data-pane="sessions"]');
    // Where the button will be: the shown row's strip, at the other row's height.
    const shownButton = await sessions
      .getByRole('button', { name, exact: true })
      .boundingBox();
    const kyoto = await sessions
      .getByRole('button', { name: 'Kyoto', exact: true })
      .boundingBox();
    if (shownButton === null || kyoto === null) throw new Error('no row boxes');
    const x = shownButton.x + shownButton.width / 2;
    const y = kyoto.y + kyoto.height / 2;
    const before = await savedTabs(page);
    const windows = await windowCount(serviceWorker);

    await page.mouse.click(x, y);
    await expect(
      sessions
        .getByRole('button', { name: 'Kyoto', exact: true })
        .locator('xpath=..')
        .locator('[data-row-actions]')
    ).toBeVisible();

    // PREMISE: the second click is one, and it reached the button.
    expect(await secondClickAt(page, x, y)).toBe(`2 ${name}`);

    // And no late press.
    await page.waitForTimeout(1000);
    expect(await savedTabs(page)).toEqual(before);
    expect(await windowCount(serviceWorker)).toBe(windows);

    // CONTROL: a click of its own there is a press. Open's is the one a count sees.
    if (name === 'Open') {
      await page.mouse.click(x, y);
      await expect.poll(() => windowCount(serviceWorker)).toBe(windows + 1);
    }
  });
}

test('a double-click on a selected folded row does no more than peek', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedSessions(context, {
    ...buildContainer([TRIP, KYOTO]),
    selectedTabGroupId: 's1',
  });
  await seedSettings(context, { foldSavedSessionInTabView: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const row = page
    .locator('[data-pane="sessions"]')
    .getByRole('button', { name: 'Trip', exact: true });
  const detail = page.locator('[data-pane="detail"]');
  // PREMISE: folded, so nothing is shown and the row has no actions yet.
  await expect(row).toBeVisible();
  await expect(detail).toHaveCount(0);
  const strip = row.locator('xpath=..').locator('[data-row-actions]');
  await expect(strip).toHaveCount(0);

  const box = await row.boundingBox();
  if (box === null) throw new Error('no row box');
  // The row's right end, where Replace, the last of its actions, will be drawn.
  const x = box.x + box.width - 24;
  const y = box.y + box.height / 2;
  const before = await savedTabs(page);
  const windows = await windowCount(serviceWorker);

  await page.mouse.click(x, y);
  await expect(strip).toBeVisible();
  await elementLanded(strip, 'ancestors');

  // PREMISE: the second click is one, and it reached the button.
  expect(await secondClickAt(page, x, y)).toBe('2 Replace');

  // The peek, and nothing else: no late press.
  await page.waitForTimeout(1000);
  await expect(detail).toBeVisible();
  expect(await savedTabs(page)).toEqual(before);
  expect(await windowCount(serviceWorker)).toBe(windows);
});
