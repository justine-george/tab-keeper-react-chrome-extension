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

  expect(ground).toBe('rgb(23, 23, 23)');
});

// Found on review: at rest the toolbar is too long for the title's row and
// wraps under it, while the short editing toolbar fits beside the title -- so
// pressing Edit made every control jump up a row. The toolbar now always has a
// row of its own, and the primary control sits at its right end in both modes:
// the PDF output at rest (KAN-207; Save as HTML before it), Done while editing.
const toolbarGeometry = (page: Page, title: string) =>
  page.evaluate((title) => {
    const byLabel = (label: string) =>
      document.querySelector(`button[aria-label="${label}"]`);
    const primary = byLabel('PDF / Print') ?? byLabel('Done');
    if (!primary) throw new Error('no primary control on the toolbar');
    // The header's title, not the editor's field: a textarea's text is its
    // value, never its textContent.
    const heading = [...document.querySelectorAll('span')].find(
      (el) => el.textContent === title
    );
    if (!heading) throw new Error('no session title in the header');
    const label = [...document.querySelectorAll('span')].find(
      (el) => el.textContent === 'Preview' || el.textContent === 'Editing'
    );
    // The header is the nearest box holding both the title and the toolbar.
    let header: Element = primary;
    while (!header.contains(heading)) header = header.parentElement!;
    const style = getComputedStyle(header);
    const box = header.getBoundingClientRect();
    const first =
      byLabel('Edit') ??
      header.querySelector('[role="status"]')!.parentElement!;
    return {
      titleBottom: heading.getBoundingClientRect().bottom,
      titleTop: heading.getBoundingClientRect().top,
      labelBottom: label ? label.getBoundingClientRect().bottom : null,
      primaryRight: primary.getBoundingClientRect().right,
      // Where the toolbar's first line starts. Not the primary control's top:
      // at 800px the resting row wraps and Save sits on a second line, while
      // the shorter editing row keeps Done on the first. The row did not move.
      firstLineTop: Math.min(
        ...[...header.querySelectorAll('button, [role="status"]')].map(
          (el) => el.getBoundingClientRect().top
        )
      ),
      firstLeft: first.getBoundingClientRect().left,
      contentLeft: box.left + parseFloat(style.paddingLeft),
      contentRight: box.right - parseFloat(style.paddingRight),
    };
  }, title);

// 1200px is where review found the jump with this title: the resting toolbar
// wraps under it, and the shorter editing toolbar fits beside it.
for (const width of [1600, 1200, 800]) {
  test(`at ${width}px the toolbar keeps its own row and does not move when editing starts`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExportPage(context, extensionId, width);

    const resting = await toolbarGeometry(page, LONG_TITLE);
    await page.getByRole('button', { name: 'Edit' }).click();
    const editing = await toolbarGeometry(page, LONG_TITLE);

    expect(resting.firstLineTop, 'a row below the title').toBeGreaterThan(
      resting.titleBottom
    );
    expect(
      Math.abs(editing.firstLineTop - resting.firstLineTop),
      `the toolbar row moved from ${resting.firstLineTop}px to ${editing.firstLineTop}px`
    ).toBeLessThanOrEqual(1);
    // The mode label sits above the title in both modes, and swapping
    // Preview for a pencil and Editing must not change its height.
    expect(resting.labelBottom, 'Preview above the title').not.toBeNull();
    expect(resting.labelBottom!).toBeLessThanOrEqual(resting.titleTop + 1);
    expect(editing.labelBottom, 'Editing above the title').not.toBeNull();
    expect(editing.labelBottom!).toBeLessThanOrEqual(editing.titleTop + 1);
    expect(
      Math.abs(editing.titleTop - resting.titleTop),
      `the title moved from ${resting.titleTop}px to ${editing.titleTop}px`
    ).toBeLessThanOrEqual(1);
  });

  test(`at ${width}px Save, then Done, sit at the right end of the toolbar`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExportPage(context, extensionId, width);

    const resting = await toolbarGeometry(page, LONG_TITLE);
    await page.getByRole('button', { name: 'Edit' }).click();
    const editing = await toolbarGeometry(page, LONG_TITLE);

    expect(
      Math.abs(resting.contentRight - resting.primaryRight),
      `Save ends at ${resting.primaryRight}px, the row at ${resting.contentRight}px`
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(editing.contentRight - editing.primaryRight),
      `Done ends at ${editing.primaryRight}px, the row at ${editing.contentRight}px`
    ).toBeLessThanOrEqual(1);
    // CONTROL: the row still starts at the left edge, so "at the right end"
    // is not a toolbar that simply moved right.
    expect(
      Math.abs(resting.firstLeft - resting.contentLeft)
    ).toBeLessThanOrEqual(1);
  });
}

// Found on review: pressing Edit still moved the page up 2px. The joined
// Layout and Colour pairs were content-box with a 1px border around 34px
// buttons, so they stood 36px against every other control's 34px; the
// resting toolbar row was 36px, the editing row 34px, and everything below
// the header rose when editing started (measured: header 127px to 125px,
// content 135px to 133px, at 1600px and at 1000px).
const headerAndRow = (page: Page) =>
  page.evaluate((title) => {
    const heading = [...document.querySelectorAll('span')].find(
      (el) => el.textContent === title
    );
    if (!heading) throw new Error('no session title in the header');
    const primary =
      document.querySelector('button[aria-label="PDF / Print"]') ??
      document.querySelector('button[aria-label="Done"]');
    if (!primary) throw new Error('no primary control on the toolbar');
    let header: Element = primary;
    while (!header.contains(heading)) header = header.parentElement!;
    const row = header.lastElementChild!;
    // The row's own controls: each button and each joined pair, but not the
    // buttons inside a pair, and not the tally, which is text.
    const controls = [...row.querySelectorAll('button, [role="group"]')].filter(
      (el) =>
        el.getAttribute('role') === 'group' || !el.closest('[role="group"]')
    );
    return {
      headerHeight: header.getBoundingClientRect().height,
      contentTop: header.nextElementSibling!.getBoundingClientRect().top,
      controls: controls.map((el) => ({
        name: el.getAttribute('aria-label') ?? '',
        height: el.getBoundingClientRect().height,
      })),
    };
  }, LONG_TITLE);

// Read once, and a slow machine can catch the header a pixel short before the
// layout has settled: a full run measured 124px at rest against 125px editing,
// while the page itself is 125px in both. Same defect as KAN-196 in another
// spec -- the fix is to poll until two reads agree, not to widen the tolerance.
async function settledHeaderAndRow(page: Page) {
  let previous = await headerAndRow(page);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(50);
    const next = await headerAndRow(page);
    const steady =
      Math.abs(next.headerHeight - previous.headerHeight) < 0.5 &&
      Math.abs(next.contentTop - previous.contentTop) < 0.5;
    if (steady) return next;
    previous = next;
  }
  throw new Error('the header never settled');
}

for (const width of [1600, 1000]) {
  test(`at ${width}px pressing Edit does not change the header's height or move the page`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExportPage(context, extensionId, width);

    const resting = await settledHeaderAndRow(page);
    await page.getByRole('button', { name: 'Edit' }).click();
    const editing = await settledHeaderAndRow(page);

    expect(
      Math.abs(editing.headerHeight - resting.headerHeight),
      `header ${resting.headerHeight}px at rest, ${editing.headerHeight}px editing`
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(editing.contentTop - resting.contentTop),
      `content starts at ${resting.contentTop}px at rest, ${editing.contentTop}px editing`
    ).toBeLessThanOrEqual(0.5);
  });

  test(`at ${width}px every toolbar control is the same height, the joined pairs included`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExportPage(context, extensionId, width);

    const resting = await settledHeaderAndRow(page);
    await page.getByRole('button', { name: 'Edit' }).click();
    const editing = await settledHeaderAndRow(page);

    const describe = (controls: { name: string; height: number }[]) =>
      controls.map((c) => `${c.name} ${c.height}px`).join(', ');
    const heights = new Set(
      [...resting.controls, ...editing.controls].map((c) => c.height)
    );
    expect(
      heights.size,
      `at rest: ${describe(resting.controls)}; editing: ${describe(
        editing.controls
      )}`
    ).toBe(1);
    // CONTROL: the pairs were found, so a pass is not an empty comparison.
    expect(resting.controls.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Layout', 'Colour', 'Edit', 'Save as HTML'])
    );
  });
}
