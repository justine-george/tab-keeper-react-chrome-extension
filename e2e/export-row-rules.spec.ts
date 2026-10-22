import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { sessionHeaderMenu } from './fixtures/menus';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

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
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(sessionHeaderMenu(popup)).toBeVisible();
  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    (async () => {
      await sessionHeaderMenu(popup).click();
      await popup.getByRole('menuitem', { name: 'Export…' }).click();
    })(),
  ]);
  await exportPage.waitForLoadState();
  return exportPage;
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

  const seen = await rows.evaluateAll((items) =>
    items.map((li) => [
      li.querySelector('a')?.textContent ?? '',
      getComputedStyle(li).borderBottomWidth,
    ])
  );
  expect(seen).toEqual(EXPECTED);
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
