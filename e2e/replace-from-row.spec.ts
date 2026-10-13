import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { stored } from './fixtures/savedWindows';
import { localeStrings } from './fixtures/locales';

// KAN-581 (picks 1A, 2A). The saved row's Replace, before Delete, in both views: the ⋮ menu's Replace with open windows (KAN-468).

const page = (title: string) => `data:text/html,<title>${title}</title>`;
const OLD = ['https://kyoto.test/', 'https://osaka.test/'];

const TRIP = buildSession({
  tabGroupId: 's-trip',
  title: 'Trip',
  windows: [
    {
      windowId: 'old-1',
      windowHeight: 800,
      windowWidth: 1200,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: OLD.length,
      title: '',
      tabs: OLD.map((url, i) => ({
        tabId: `old-${i}`,
        favicon: '',
        title: url,
        url,
      })),
    },
  ],
});
const SHOWN = buildSession({ tabGroupId: 's-shown', title: 'Shown' });

const VIEWS = {
  popup: { path: 'index.html', size: { width: 790, height: 550 } },
  full: { path: 'index.html?view=tab', size: { width: 1280, height: 800 } },
} as const;

async function openList(
  context: BrowserContext,
  extensionId: string,
  view: keyof typeof VIEWS
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([SHOWN, TRIP]),
    selectedTabGroupId: 's-shown',
  });
  const list = await context.newPage();
  await list.setViewportSize(VIEWS[view].size);
  await list.goto(`chrome-extension://${extensionId}/${VIEWS[view].path}`);
  await expect(
    list.getByRole('button', { name: 'Trip', exact: true })
  ).toBeVisible();
  return list;
}

// The row's own actions: a session's row is its title button, with the actions beside it.
const actionsOf = (list: Page, title: string) =>
  list
    .getByRole('button', { name: title, exact: true })
    .locator('xpath=..')
    .locator('[data-row-actions]');

const trip = async (list: Page) => {
  const s = (await stored(list)).tabGroups.find(
    (g) => g.tabGroupId === 's-trip'
  );
  if (s === undefined) throw new Error('Trip is gone');
  return s.windows.flatMap((w) => w.tabs.map((t) => t.url));
};

const openTwoWindows = (worker: Worker) =>
  worker.evaluate(
    async (urls) => {
      for (const url of urls)
        await chrome.windows.create({ url, focused: false });
    },
    [page('Open A'), page('Open B')]
  );

for (const view of ['popup', 'full'] as const) {
  test(`${view}: the row's Replace sits before Delete, fills that session with what is open, leaves the shown one shown, and ⌘Z takes it back`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const list = await openList(context, extensionId, view);
    await openTwoWindows(serviceWorker);
    const actions = actionsOf(list, 'Trip');
    await expect(actions.getByRole('button')).toHaveText(
      view === 'popup'
        ? [/Open/, /Switch/, /Replace/, /Delete/]
        : [/Open/, /Replace/, /Delete/]
    );

    await actions.getByRole('button', { name: 'Replace', exact: true }).click();

    await expect
      .poll(() => trip(list))
      .toEqual(expect.arrayContaining([page('Open A'), page('Open B')]));
    expect(await trip(list)).not.toContain(OLD[0]);
    expect((await stored(list)).selectedTabGroupId).toBe('s-shown');
    // The popup shows the selected session beside the list; the full view shows Open now there.
    if (view === 'popup')
      await expect(
        list.getByRole('button', { name: 'Rename session: Shown' })
      ).toBeVisible();
    await expect(
      list.getByText('Session replaced with all open windows.')
    ).toBeVisible();

    await list.keyboard.press('ControlOrMeta+z');

    await expect.poll(() => trip(list)).toEqual(OLD);
  });
}

// Each row label stays inside its own 57px button, so neighbours never run together.
const LANGS = [
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'sv',
  'zh',
  'zh-TW',
];
for (const view of ['popup', 'full'] as const) {
  test(`${view}: in every language, each row label fits inside its button`, async ({
    context,
    extensionId,
  }) => {
    const spills: string[] = [];
    for (const lang of LANGS) {
      await seedSettings(context, { language: lang });
      const list = await openList(context, extensionId, view);
      const actions = actionsOf(list, 'Trip');
      // PREMISE: the row has all its buttons, and Replace is in this language.
      await expect(actions.getByRole('button')).toHaveCount(
        view === 'popup' ? 4 : 3
      );
      await expect(
        actions
          .getByRole('button')
          .nth(view === 'popup' ? 2 : 1)
          .locator('p')
      ).toHaveText(localeStrings(lang).Replace ?? 'Replace');
      const boxes = await actions.evaluate((el) =>
        [...el.querySelectorAll('[role="button"]')].map((button) => {
          const label = button.querySelector('p');
          if (label === null) throw new Error('a button without a label');
          const text = document.createRange();
          text.selectNodeContents(label);
          const b = button.getBoundingClientRect();
          const t = text.getBoundingClientRect();
          return {
            label: label.textContent ?? '',
            left: t.left - b.left,
            right: b.right - t.right,
          };
        })
      );
      for (const box of boxes)
        if (box.left < 0 || box.right < 0)
          spills.push(
            `${lang} "${box.label}" ${box.left.toFixed(1)}/${box.right.toFixed(1)}`
          );
      await list.close();
    }
    expect(spills).toEqual([]);
  });
}
