import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-740 on the real export page: in Compact, a rule sits only BETWEEN rows.
// The last row of a window's list and the last tab of a group draw none, so
// the file never ends on a rule above the footer's own. Edit mode, which lays
// the same rows out, follows the same rule.

const tab = (id: string, title: string, chromeGroupId?: string) => ({
  tabId: id,
  favicon: '',
  title,
  url: `https://${id}.test/`,
  ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
});

const windowOf = (
  windowId: string,
  tabs: ReturnType<typeof tab>[],
  groups: { groupId: string; title: string; color: 'blue' | 'red' }[]
) => ({
  windowId,
  windowHeight: 800,
  windowWidth: 1200,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: '',
  tabs,
  chromeTabGroups: groups,
});

// Window 1 ends on ungrouped tabs; window 2 ends on a group.
const SESSION = buildSession({
  tabGroupId: 'session-rules',
  title: 'Rules',
  isSelected: true,
  windowCount: 2,
  tabCount: 7,
  windows: [
    windowOf(
      'w-1',
      [
        tab('nozomi', 'Nozomi', 'g-1'),
        tab('haruka', 'Haruka', 'g-1'),
        tab('inari', 'Inari'),
        tab('gion', 'Gion'),
      ],
      [{ groupId: 'g-1', title: 'Flights', color: 'blue' }]
    ),
    windowOf(
      'w-2',
      [
        tab('docs', 'Docs'),
        tab('hotel', 'Hotel', 'g-2'),
        tab('ryokan', 'Ryokan', 'g-2'),
      ],
      [{ groupId: 'g-2', title: 'Stay', color: 'red' }]
    ),
  ],
});

// Each tab row's bottom rule, in document order, by title.
const EXPECTED = [
  ['Nozomi', '1px'],
  ['Haruka', '0px'], // the group's last tab
  ['Inari', '1px'],
  ['Gion', '0px'], // window 1's last row
  ['Docs', '1px'],
  ['Hotel', '1px'],
  ['Ryokan', '0px'], // the group's last tab, and window 2's last row
];

async function openExport(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-rules',
  });
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-rules`
  );
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  return page;
}

// The file's rows, by title, with each one's bottom rule.
async function fileRules(page: Page): Promise<string[][]> {
  return page
    .frameLocator('iframe')
    .locator('li.tab')
    .evaluateAll((items) =>
      items.map((li) => [
        li.querySelector('a')?.textContent ?? '',
        getComputedStyle(li).borderBottomWidth,
      ])
    );
}

test('Compact: a rule sits between rows, never under a list’s last row', async ({
  context,
  extensionId,
}) => {
  const exportPage = await openExport(context, extensionId);
  const rows = exportPage.frameLocator('iframe').locator('li.tab');
  // PREMISE: the file is Compact (the default) and holds every row.
  await expect(exportPage.frameLocator('iframe').locator('body')).toHaveClass(
    /compact/
  );
  await expect(rows).toHaveCount(EXPECTED.length);
  expect(await fileRules(exportPage)).toEqual(EXPECTED);
});

test('hiding a list’s last row in Edit takes the rule off the row now last', async ({
  context,
  extensionId,
}) => {
  const exportPage = await openExport(context, extensionId);
  await exportPage.getByRole('button', { name: 'Edit', exact: true }).click();
  // Window 1's last row, and window 2's group's last tab.
  for (const title of ['Gion', 'Ryokan']) {
    await exportPage.getByRole('button', { name: `Hide: ${title}` }).click();
  }
  await exportPage.getByRole('button', { name: 'Done' }).click();

  await expect(exportPage.frameLocator('iframe').locator('li.tab')).toHaveCount(
    5
  );
  expect(await fileRules(exportPage)).toEqual([
    ['Nozomi', '1px'],
    ['Haruka', '0px'],
    ['Inari', '0px'], // window 1's last row once Gion is hidden
    ['Docs', '1px'],
    ['Hotel', '0px'], // the group's last tab once Ryokan is hidden
  ]);
});

test('Edit mode: the same rows draw the same rules', async ({
  context,
  extensionId,
}) => {
  const exportPage = await openExport(context, extensionId);
  await exportPage.getByRole('button', { name: 'Edit', exact: true }).click();
  const fields = exportPage.getByRole('textbox', { name: 'Rename tab' });
  await expect(fields).toHaveCount(EXPECTED.length);

  const seen = await fields.evaluateAll((inputs) =>
    inputs.map((input) => {
      const li = input.closest('li');
      if (li === null) throw new Error('a tab field outside a row');
      return [
        input instanceof HTMLInputElement ? input.value : '',
        getComputedStyle(li).borderBottomWidth,
      ];
    })
  );
  expect(seen).toEqual(EXPECTED);
});

// KAN-741. In Comfortable, Edit draws the Comfortable file's rows: no rules,
// and the whole address under each title, wrapping rather than widening the page.
test('in Comfortable, Edit shows each full address and no row rules, and wraps at 560', async ({
  context,
  extensionId,
}) => {
  const LONG = `https://long.test/${'a'.repeat(182)}`;
  const session = {
    ...SESSION,
    tabCount: 8,
    windows: [
      SESSION.windows[0],
      {
        ...SESSION.windows[1],
        tabCount: 4,
        tabs: [
          ...SESSION.windows[1].tabs,
          { tabId: 'long', favicon: '', title: 'Long', url: LONG },
        ],
      },
    ],
  };
  await seedSettings(context, { exportLayout: 'comfortable' });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 'session-rules',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 560, height: 900 });
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-rules`
  );
  // PREMISE: the file is Comfortable.
  await expect(page.frameLocator('iframe').locator('body')).toHaveClass(
    /comfortable/
  );
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const fields = page.getByRole('textbox', { name: 'Rename tab' });
  await expect(fields).toHaveCount(8);
  expect(LONG).toHaveLength(200);

  const rows = await fields.evaluateAll((inputs) =>
    inputs.map((input) => {
      const li = input.closest('li');
      if (li === null) throw new Error('a tab field outside a row');
      return [li.textContent ?? '', getComputedStyle(li).borderBottomStyle];
    })
  );
  const urls = [
    ...SESSION.windows[0].tabs.map((t) => t.url),
    ...SESSION.windows[1].tabs.map((t) => t.url),
    LONG,
  ];
  rows.forEach(([text, border], index) => {
    expect(text).toContain(urls[index]);
    expect(border).toBe('none');
  });
  await expect(page.getByText(LONG, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
