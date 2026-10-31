import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-602. Chrome's menu Print… bypasses the page's keys and prints the page
// itself. It must print the file -- whole, with its edits -- and none of the
// page around it. Print media is emulated; page.pdf() is the real output.

const papers = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i;
    return {
      tabId: `paper-${n}`,
      favicon: '',
      title: `Paper ${n}`,
      url: `https://papers.test/${n}`,
    };
  });

const windowOf = (windowId: string, tabs: ReturnType<typeof papers>) => ({
  windowId,
  windowHeight: 800,
  windowWidth: 1200,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: '',
  tabs,
  chromeTabGroups: [],
});

const SESSION = buildSession({
  tabGroupId: 'session-thesis',
  title: 'Thesis research',
  isSelected: true,
  windowCount: 2,
  tabCount: 40,
  windows: [windowOf('w-1', papers(1, 25)), windowOf('w-2', papers(26, 40))],
});

async function openExport(
  context: BrowserContext,
  extensionId: string,
  session = 'session-thesis'
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-thesis',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=${session}`
  );
  return page;
}

const loaded = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  // The file has settled: icons read and the frame shows them.
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute(
    'data-icons',
    'ready'
  );
};

// Pages in a PDF Chrome wrote: each page object is `/Type /Page`, the tree `/Pages`.
const pageCount = (pdf: Buffer) =>
  (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;

const copy = (page: Page) => page.locator('[data-print-copy]');

test('print media shows only the file, every tab of it', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId);
  await loaded(page);

  // CONTROL: on screen the page is the page, and the copy is not shown.
  await expect(page.locator('[data-toolbar-row]')).toBeVisible();
  await expect(copy(page)).toBeHidden();

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-preview-header]')).toBeHidden();
  await expect(page.locator('[data-toolbar-row]')).toBeHidden();
  await expect(page.getByText('Preview', { exact: true })).toBeHidden();
  await expect(page.locator('iframe')).toBeHidden();
  await expect(copy(page)).toBeVisible();
  // Playwright's CSS locators pierce the open shadow root.
  await expect(copy(page).locator('h1')).toHaveText('Thesis research');
  await expect(copy(page).locator('li.tab')).toHaveCount(40);
  await expect(copy(page).getByText('Paper 40', { exact: true })).toBeVisible();
  // The file's own rules apply inside the copy: its page colour, its layout.
  const look = await copy(page)
    .locator('.tk-print-body')
    .evaluate((body) => ({
      background: getComputedStyle(body).backgroundColor,
      ruleUnderRows: getComputedStyle(body.querySelector('li.tab')!)
        .borderBottomStyle,
    }));
  expect(look.background).toBe('rgb(255, 255, 255)');
  expect(look.ruleUnderRows).toBe('solid'); // Compact, the default
});

test('the page prints as many pages as the file alone', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId);
  await loaded(page);
  const file = await page
    .locator('iframe')
    .evaluate((frame) => (frame as HTMLIFrameElement).getAttribute('srcdoc'));
  expect(file).toContain('Paper 40');

  const printed = pageCount(await page.pdf({ format: 'Letter' }));
  const alone = await context.newPage();
  await alone.setContent(file!);
  const expected = pageCount(await alone.pdf({ format: 'Letter' }));

  // CONTROL: the file runs past one page, so a cut-off list would show.
  expect(expected).toBeGreaterThan(1);
  // A blank first page, or the list cut at the frame, changes the count.
  expect(printed).toBe(expected);
});

test('in Edit, a renamed tab prints renamed', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId);
  await loaded(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Rename tab: Paper 7' });
  await field.fill('Renamed paper');
  await field.press('Enter');

  await page.emulateMedia({ media: 'print' });
  await expect(copy(page).getByText('Renamed paper')).toBeVisible();
  await expect(copy(page).getByText('Paper 7', { exact: true })).toHaveCount(0);
  // The editor itself never prints.
  await expect(
    page.getByRole('textbox', { name: /^Rename tab/ }).first()
  ).toBeHidden();
});

test("in Edit, the print dialog's title is the edited session title", async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId);
  await loaded(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Rename session: Thesis research' })
    .fill('Thesis, chapter 2');

  const titles = await page.evaluate(() => {
    dispatchEvent(new Event('beforeprint'));
    const during = document.title;
    dispatchEvent(new Event('afterprint'));
    return { during, after: document.title };
  });
  expect(titles).toEqual({
    during: 'Thesis, chapter 2',
    after: 'Thesis research',
  });
});

test('every tab hidden: the file prints as it stands', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId);
  await loaded(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  for (const name of ['Hide: Window 1', 'Hide: Window 2']) {
    await page.getByRole('button', { name }).click();
  }

  await page.emulateMedia({ media: 'print' });
  await expect(copy(page).locator('h1')).toHaveText('Thesis research');
  await expect(copy(page).locator('li.tab')).toHaveCount(0);
});

test('a dark file prints dark to the paper edges', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId);
  await loaded(page);
  await page.getByRole('button', { name: 'Dark' }).click();
  const fileBg = await page
    .frameLocator('iframe')
    .locator('body')
    .evaluate((body) => getComputedStyle(body).backgroundColor);
  // CONTROL: the file really is dark.
  expect(fileBg).not.toBe('rgb(255, 255, 255)');

  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
  }));
  expect(printed).toEqual({ html: fileBg, body: fileBg });
  await expect
    .poll(() =>
      copy(page)
        .locator('.tk-print-body')
        .evaluate((body) => getComputedStyle(body).backgroundColor)
    )
    .toBe(fileBg);
});

test('a session that is not found prints the page as it is', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId, 'missing');
  await expect(page.getByText('Session not found')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByText('Session not found')).toBeVisible();
  await expect(copy(page)).toHaveCount(0);
});
