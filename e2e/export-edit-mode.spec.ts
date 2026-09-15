import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-194. The export page's Edit mode, in a real browser. The component tests
// hold the wiring; only a browser can say what they cannot:
//
// - that a file saved after editing, written to disk, carries the edits;
// - that the editor fits its page, a long title wrapping instead of clipping;
// - that Chrome really asks before closing with edits pending -- and, as the
//   control, does not ask without them.

const LONG_TITLE =
  'Pull requests · justine-george/tab-keeper-react-chrome-extension';

const SESSION = buildSession({
  tabGroupId: 'session-edit',
  title: LONG_TITLE,
  isSelected: true,
  windowCount: 2,
  tabCount: 4,
  windows: [
    {
      windowId: 'w-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 3,
      title: 'Installs & Uninstalls',
      tabs: [
        {
          tabId: 't-1',
          favicon: '',
          title: 'Board - KAN board - Jira',
          url: 'https://justinegeo96.atlassian.example/board',
        },
        {
          tabId: 't-2',
          favicon: '',
          title: 'Order Details - Apple',
          url: 'https://secure9.store.apple.example/order',
          chromeGroupId: 'g-1',
        },
        {
          tabId: 't-3',
          favicon: '',
          title:
            '(1) Rive on X: "GPU Canvas is now live for everyone. Rive\'s low-level GPU layer for 3D, shaders, and custom rendering"',
          url: 'https://x.example/rive/status/1',
          chromeGroupId: 'g-1',
        },
      ],
      chromeTabGroups: [{ groupId: 'g-1', title: 'Twitter', color: 'blue' }],
    },
    {
      windowId: 'w-2',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'justine-george (Justine George)',
      tabs: [
        {
          tabId: 't-4',
          favicon: '',
          title: 'justine-george/RealTalk',
          url: 'https://github.example/justine-george/RealTalk',
        },
      ],
    },
  ],
});

async function openExportPage(
  context: BrowserContext,
  extensionId: string,
  width = 1000
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-edit',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-edit`
  );
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  return page;
}

test('an edited export saves the renamed, trimmed file to disk', async ({
  context,
  extensionId,
}) => {
  const page = await openExportPage(context, extensionId);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page
    .getByRole('textbox', { name: `Rename session: ${LONG_TITLE}` })
    .fill('Tab Keeper launch links');
  await page
    .getByRole('textbox', { name: 'Rename tab: Board - KAN board - Jira' })
    .fill('Our board');
  await page
    .getByRole('button', { name: 'Hide: Order Details - Apple' })
    .click();
  await expect(page.getByText('2 renamed · 1 hidden')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // The page's own header follows the edits too.
  await expect(page.getByText('2 Windows - 3 Tabs')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as HTML' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^Tab Keeper launch links - \d{4}-\d{2}-\d{2}\.html$/
  );
  const path = join(
    mkdtempSync(join(tmpdir(), 'export-edit-')),
    download.suggestedFilename()
  );
  await download.saveAs(path);
  const file = readFileSync(path, 'utf8');

  expect(file).toContain('<h1>Tab Keeper launch links</h1>');
  expect(file).toContain('>Our board</a>');
  expect(file).not.toContain('secure9.store.apple.example');
  // CONTROL: the untouched rows are all still in the file.
  expect(file).toContain('https://x.example/rive/status/1');
  expect(file).toContain('https://github.example/justine-george/RealTalk');
});

test('the editor fits its page: a long title wraps, and no row runs off the side', async ({
  context,
  extensionId,
}) => {
  const page = await openExportPage(context, extensionId, 800);
  await page.getByRole('button', { name: 'Edit' }).click();

  const title = page.getByRole('textbox', {
    name: `Rename session: ${LONG_TITLE}`,
  });
  const box = await title.evaluate((el) => {
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight);
    return {
      lines: Math.round(
        (el.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom)) /
          lineHeight
      ),
      clipped: el.scrollHeight > el.clientHeight + 1,
    };
  });
  expect(box.lines).toBeGreaterThanOrEqual(2);
  expect(box.clipped).toBe(false);

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const eyes = [...document.querySelectorAll('button[aria-label^="Hide: "]')];
    return {
      pageScrollsSideways: doc.scrollWidth > window.innerWidth,
      eyesOffScreen: eyes.filter(
        (eye) => eye.getBoundingClientRect().right > window.innerWidth
      ).length,
      eyes: eyes.length,
    };
  });
  // Every row has one: two windows, one group, four tabs.
  expect(overflow.eyes).toBe(7);
  expect(overflow.eyesOffScreen).toBe(0);
  expect(overflow.pageScrollsSideways).toBe(false);
});

// CONTROL for the wrap: the same field with a short title is one line, so the
// test above measures wrapping and not a field that is always tall.
test('CONTROL: a short title stays on one line', async ({
  context,
  extensionId,
}) => {
  const page = await openExportPage(context, extensionId, 800);
  await page.getByRole('button', { name: 'Edit' }).click();

  const title = page.getByRole('textbox', {
    name: `Rename session: ${LONG_TITLE}`,
  });
  await title.fill('Short');

  const lines = await title.evaluate((el) => {
    const style = getComputedStyle(el);
    return Math.round(
      (el.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom)) /
        parseFloat(style.lineHeight)
    );
  });
  expect(lines).toBe(1);
});

test('a hidden row stays in the editor, faded, until it is shown again', async ({
  context,
  extensionId,
}) => {
  const page = await openExportPage(context, extensionId);
  await page.getByRole('button', { name: 'Edit' }).click();

  const field = page.getByRole('textbox', {
    name: 'Rename tab: justine-george/RealTalk',
  });
  const opacity = () =>
    field.evaluate((el) => {
      let value = 1;
      for (let node: Element | null = el; node; node = node.parentElement) {
        value *= parseFloat(getComputedStyle(node).opacity);
      }
      return value;
    });

  expect(await opacity()).toBe(1);
  await page
    .getByRole('button', { name: 'Hide: justine-george/RealTalk' })
    .click();
  await expect(field).toBeVisible();
  expect(await opacity()).toBeLessThan(0.6);

  await page
    .getByRole('button', { name: 'Hide: justine-george/RealTalk' })
    .click();
  expect(await opacity()).toBe(1);
});

// Chrome draws its own leave dialog, and only when a beforeunload listener
// cancels the event. Measured before building: Playwright's scripted close
// shows that dialog whenever a listener cancels, so the discriminating control
// is the page WITHOUT edits, which must register no such listener.
for (const edited of [true, false]) {
  test(`closing the page ${
    edited ? 'with an edit asks first' : 'without edits does not ask'
  }`, async ({ context, extensionId }) => {
    const page = await openExportPage(context, extensionId);
    if (edited) {
      await page.getByRole('button', { name: 'Edit' }).click();
      await page
        .getByRole('button', { name: 'Hide: Order Details - Apple' })
        .click();
    }

    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.type());
      await dialog.accept();
    });
    await page.close({ runBeforeUnload: true });
    await expect
      .poll(() => (edited ? dialogs.length : page.isClosed() ? 0 : -1))
      .toBe(edited ? 1 : 0);

    expect(dialogs).toEqual(edited ? ['beforeunload'] : []);
  });
}

// The editor draws the file's rows, so it takes the file's colours: a dark
// export is edited on the dark file's ground, not the toolbar's.
test('editing a dark export happens on the dark file ground', async ({
  context,
  extensionId,
}) => {
  const page = await openExportPage(context, extensionId);
  await page.getByRole('button', { name: 'Dark' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();

  const ground = await page
    .getByRole('textbox', { name: `Rename session: ${LONG_TITLE}` })
    .evaluate((el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)') return color;
      }
      return 'none';
    });

  expect(ground).toBe('rgb(23, 25, 29)');
});
