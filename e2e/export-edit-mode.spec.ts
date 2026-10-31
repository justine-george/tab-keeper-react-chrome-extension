import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { previewFile } from './fixtures/previewFile';
import { placeholderPaint, rgb } from './fixtures/pixels';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { EXPORT_PALETTE } from '../src/utils/functions/sessionExportHtml';

// KAN-194. What only a browser can show: the saved file carries the edits, the
// editor fits its page, and Chrome asks before closing only with edits pending.

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

test("an edited export's file carries the renames and hidden rows", async ({
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

  // KAN-880. The counts left the header; the sheet's own line follows the hide.
  await expect(
    page.frameLocator('iframe').getByText('2 Windows · 3 Tabs')
  ).toBeVisible();

  const { html: file } = await previewFile(page, 'export-edit-');

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
  // One per row: two windows, one group, four tabs.
  expect(overflow.eyes).toBe(7);
  expect(overflow.eyesOffScreen).toBe(0);
  expect(overflow.pageScrollsSideways).toBe(false);
});

// CONTROL: the test above measures wrapping, not a field that is always tall.
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
  // Polled: the row fades over 150ms (KAN-222).
  await expect.poll(opacity).toBeLessThan(0.6);

  await page
    .getByRole('button', { name: 'Hide: justine-george/RealTalk' })
    .click();
  await expect.poll(opacity).toBe(1);
});

// KAN-401. With every row hidden Done is unavailable, and an unavailable
// button keeps its resting fill under the pointer. Done's fill is the page's
// own, so the pointer once swapped it for the light one and hid the tick.
test('with every row hidden, Done is unavailable and keeps its fill under the pointer', async ({
  context,
  extensionId,
}) => {
  const page = await openExportPage(context, extensionId);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page
    .getByRole('button', { name: 'Hide: Installs & Uninstalls' })
    .click();
  await page
    .getByRole('button', { name: 'Hide: justine-george (Justine George)' })
    .click();

  const done = page.getByRole('button', { name: 'Done' });
  await expect(done).toHaveAttribute('aria-disabled', 'true');
  const fill = () =>
    done.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.mouse.move(5, 5);
  const rest = await fill();

  await done.hover();
  // Polled past the 120ms colour transition.
  await page.waitForTimeout(300);
  expect(await fill()).toBe(rest);
  await done.click({ force: true });
  await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
});

// Playwright's scripted close shows the leave dialog whenever a beforeunload
// listener cancels (measured), so the control is the page without edits.
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

// The editor draws the file's rows, so it takes the file's ground, not the
// toolbar's.
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

  expect(ground).toBe(rgb(EXPORT_PALETTE.dark.bg));
});

// KAN-402. An unnamed window's "Window N" placeholder is the file's muted
// colour, legible on the file's ground in both schemes.
const UNNAMED = buildSession({
  tabGroupId: 'session-unnamed',
  title: 'Unnamed',
  isSelected: true,
  windowCount: 1,
  tabCount: 1,
  windows: [
    {
      windowId: 'w-u',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: '',
      tabs: [
        { tabId: 't-u', favicon: '', title: 'Page', url: 'https://u.test/' },
      ],
    },
  ],
});

// The page opens on the extension theme's polarity (KAN-198).
for (const [scheme, theme] of [
  ['light', 'Light'],
  ['dark', 'Darkenheimer'],
] as const) {
  test(`${scheme} export, editing: an unnamed window's placeholder is the file's muted colour, 4.5:1 on its ground`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, {
      ...buildContainer([UNNAMED]),
      selectedTabGroupId: 'session-unnamed',
    });
    await seedSettings(context, { theme });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(
      `chrome-extension://${extensionId}/export.html?session=session-unnamed`
    );
    // goto resolves before the page mounts (KAN-105).
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    const field = page.getByRole('textbox', {
      name: 'Rename window: Window 1',
    });
    await expect(field).toHaveAttribute('placeholder', 'Window 1');

    const { placeholder, opacity, ground, ratio } =
      await placeholderPaint(field);
    console.log(
      `[${scheme}] placeholder ${placeholder} on ground ${ground}: ${ratio.toFixed(
        2
      )}:1`
    );
    expect(opacity).toBe('1');
    expect(placeholder.toLowerCase()).toBe(EXPORT_PALETTE[scheme].muted);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}

// The toolbar keeps a row of its own, under the way back (KAN-880), so Edit
// moves no control. The session's title is on the sheet: the file's h1 in
// Preview, the editor's title field in Editing.
async function toolbarGeometry(page: Page) {
  // The frame's file lands after the toolbar; Editing's field with the editor.
  await page.waitForFunction(
    () =>
      document.querySelector('iframe')?.contentDocument?.querySelector('h1') ??
      document.querySelector('textarea[aria-label^="Rename session"]')
  );
  return page.evaluate(() => {
    const byLabel = (label: string) =>
      document.querySelector(`button[aria-label="${label}"]`);
    const primary = byLabel('Save as PDF…') ?? byLabel('Done');
    if (!primary) throw new Error('no primary control on the toolbar');
    const header = document.querySelector('[data-preview-header]');
    if (!header) throw new Error('no header');
    const row = header.querySelector('[data-toolbar-row]');
    if (!row) throw new Error('no toolbar row in the header');
    // The way back's line, not its button: the button's padded target reaches the row.
    const back = row.previousElementSibling;
    if (!back?.querySelector('button[aria-label="Back to Tab Keeper"]')) {
      throw new Error('no way back in the header');
    }
    const label = header.nextElementSibling!;
    const frame = document.querySelector('iframe');
    const h1 = frame?.contentDocument?.querySelector('h1');
    const field = document.querySelector(
      'textarea[aria-label^="Rename session"]'
    );
    const titleTop =
      frame && h1
        ? frame.getBoundingClientRect().top +
          frame.clientTop +
          h1.getBoundingClientRect().top
        : field?.getBoundingClientRect().top;
    if (titleTop === undefined)
      throw new Error('no session title on the sheet');
    const box = row.getBoundingClientRect();
    const first =
      byLabel('Edit') ??
      header.querySelector('[role="status"]')!.parentElement!;
    return {
      backTop: back.getBoundingClientRect().top,
      backBottom: back.getBoundingClientRect().bottom,
      titleTop,
      // Its word, not the pencil's ligature text.
      label: label.lastElementChild?.textContent,
      labelBottom: label.getBoundingClientRect().bottom,
      primaryRight: primary.getBoundingClientRect().right,
      primaryTop: primary.getBoundingClientRect().top,
      // Not the primary control's top: at 560px the resting row wraps it to a
      // second line.
      firstLineTop: Math.min(
        ...[...row.querySelectorAll('button, [role="status"]')].map(
          (el) => el.getBoundingClientRect().top
        )
      ),
      firstLeft: first.getBoundingClientRect().left,
      contentLeft: box.left,
      contentRight: box.right,
      edit: byLabel('Edit')?.getBoundingClientRect().toJSON() ?? null,
      done: byLabel('Done')?.getBoundingClientRect().toJSON() ?? null,
      tallyRight:
        header.querySelector('[role="status"]')?.getBoundingClientRect()
          .right ?? null,
    };
  });
}

// At 560px the resting row itself wraps (en fits one line at 564px since
// Layout became glyphs, KAN-827); the editing row does not.
for (const width of [1600, 1200, 800, 560]) {
  test(`at ${width}px the toolbar keeps its own row and does not move when editing starts`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExportPage(context, extensionId, width);

    const resting = await toolbarGeometry(page);
    await page.getByRole('button', { name: 'Edit' }).click();
    const editing = await toolbarGeometry(page);

    expect(resting.firstLineTop, 'a row below the way back').toBeGreaterThan(
      resting.backBottom
    );
    expect(
      Math.abs(editing.firstLineTop - resting.firstLineTop),
      `the toolbar row moved from ${resting.firstLineTop}px to ${editing.firstLineTop}px`
    ).toBeLessThanOrEqual(1);
    expect(editing.backTop).toBeCloseTo(resting.backTop, 0);
    // The mode label names the mode, above the sheet's title, in both.
    expect(resting.label).toBe('Preview');
    expect(resting.labelBottom).toBeLessThanOrEqual(resting.titleTop + 1);
    expect(editing.label).toBe('Editing');
    expect(editing.labelBottom).toBeLessThanOrEqual(editing.titleTop + 1);
    if (width === 560) return;
    // Where both rows hold one line, swapping Preview for Editing moves neither the label nor the title.
    expect(
      Math.abs(editing.labelBottom - resting.labelBottom),
      `the label moved from ${resting.labelBottom}px to ${editing.labelBottom}px`
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(editing.titleTop - resting.titleTop),
      `the title moved from ${resting.titleTop}px to ${editing.titleTop}px`
    ).toBeLessThanOrEqual(1);
  });

  // KAN-831. Done stands where Edit stood, so finishing an edit is a press in
  // place; the tally takes the end of the row.
  test(`at ${width}px Save as PDF… ends the toolbar, and Done takes Edit's spot`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExportPage(context, extensionId, width);

    const resting = await toolbarGeometry(page);
    await page.getByRole('button', { name: 'Edit' }).click();
    const editing = await toolbarGeometry(page);

    expect(
      Math.abs(resting.contentRight - resting.primaryRight),
      `Save as PDF… ends at ${resting.primaryRight}px, the row at ${resting.contentRight}px`
    ).toBeLessThanOrEqual(1);
    const edit = resting.edit!;
    const done = editing.done!;
    expect(
      Math.abs(done.left - edit.left),
      `Done starts at ${done.left}px, Edit started at ${edit.left}px`
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(done.top - edit.top),
      `Done's top is ${done.top}px, Edit's was ${edit.top}px`
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(editing.contentRight - editing.tallyRight!),
      `the tally ends at ${editing.tallyRight}px, the row at ${editing.contentRight}px`
    ).toBeLessThanOrEqual(1);
    // CONTROL: at 560px the end group really did wrap to its own line.
    if (width === 560) {
      expect(resting.primaryTop).toBeGreaterThan(resting.firstLineTop + 1);
    }
    // CONTROL: the row still starts at the left edge, so it did not simply move
    // right.
    expect(
      Math.abs(resting.firstLeft - resting.contentLeft)
    ).toBeLessThanOrEqual(1);
  });
}

// At 560px the resting row wraps and the editing row does not, so the sheet, and the title on it, move up when Edit is pressed.
test("at 560px pressing Edit moves the sheet's title 44px up", async ({
  context,
  extensionId,
}) => {
  const page = await openExportPage(context, extensionId, 560);
  const resting = await toolbarGeometry(page);
  await page.getByRole('button', { name: 'Edit' }).click();
  const editing = await toolbarGeometry(page);
  // Open, his call (KAN-880): today's move, measured -44 headless; red if it changes or the page breaks.
  expect(editing.titleTop - resting.titleTop).toBeGreaterThanOrEqual(-46);
  expect(editing.titleTop - resting.titleTop).toBeLessThanOrEqual(-42);
});

// The pairs once stood 36px against the other controls' 34px, so pressing Edit
// moved the page up 2px.
const headerAndRow = (page: Page) =>
  page.evaluate(() => {
    const header = document.querySelector('[data-preview-header]');
    if (!header) throw new Error('no header');
    const row = header.querySelector('[data-toolbar-row]');
    if (!row) throw new Error('no toolbar row in the header');
    // Each button and each pair, but not the buttons inside a pair.
    const controls = [...row.querySelectorAll('button, [role="group"]')].filter(
      (el) =>
        el.getAttribute('role') === 'group' || !el.closest('[role="group"]')
    );
    // After the mode label: the preview's frame, or the editor's sheet.
    const sheet = header.nextElementSibling!.nextElementSibling!;
    return {
      headerHeight: header.getBoundingClientRect().height,
      headerBottom: header.getBoundingClientRect().bottom,
      sheetTop: sheet.getBoundingClientRect().top,
      controls: controls.map((el) => ({
        name: el.getAttribute('aria-label') ?? '',
        height: el.getBoundingClientRect().height,
      })),
    };
  });

// A single read on a slow machine caught the header 1px short (124 vs 125px)
// before layout settled, as KAN-196 did elsewhere: poll until two reads agree
// rather than widen the tolerance.
async function settledHeaderAndRow(page: Page) {
  let previous = await headerAndRow(page);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(50);
    const next = await headerAndRow(page);
    const steady =
      Math.abs(next.headerHeight - previous.headerHeight) < 0.5 &&
      Math.abs(next.sheetTop - previous.sheetTop) < 0.5;
    if (steady) return next;
    previous = next;
  }
  throw new Error('the header never settled');
}

for (const width of [1600, 1000]) {
  // KAN-826. The preview is a sheet under the header; KAN-880: 36px under it,
  // the mode label between, and the editor lies on the same sheet.
  test(`at ${width}px pressing Edit does not change the header's height, and the editor's sheet is where the preview's was`, async ({
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
      resting.sheetTop - resting.headerBottom,
      `the sheet starts ${resting.sheetTop - resting.headerBottom}px under the header`
    ).toBeCloseTo(36, 0);
    expect(
      Math.abs(editing.sheetTop - resting.sheetTop),
      `the editor's sheet starts at ${editing.sheetTop}px, the preview's at ${resting.sheetTop}px`
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
      expect.arrayContaining(['Layout', 'Colour', 'Edit', 'Copy all links'])
    );
  });
}
