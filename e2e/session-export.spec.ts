import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-190. The whole path, in a real browser: the icon in the popup opens the
// preview page, the page previews the file, and Save writes that same file to
// disk. The unit tests hold the STRING the generator returns; only this can
// say that a browser produced a file containing it.
//
// The last test opens the saved file from `file://` -- how it will actually be
// read -- and watches for network traffic. A favicon or a webfont that crept
// back in would show up there and nowhere else.

const KYOTO = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
  isSelected: true,
  windowCount: 1,
  tabCount: 4,
  windows: [
    {
      windowId: 'w-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 4,
      title: 'Trip planning',
      tabs: [
        {
          tabId: 't-1',
          favicon: '',
          title: 'Nozomi timetable',
          url: 'https://www.jr-central.co.jp/en/nozomi/',
          chromeGroupId: 'g-1',
        },
        {
          tabId: 't-2',
          favicon: '',
          title: 'Haruka express',
          url: 'https://www.westjr.co.jp/global/en/ticket/haruka/',
          chromeGroupId: 'g-1',
        },
        {
          tabId: 't-3',
          favicon: '',
          title: 'Fushimi Inari',
          url: 'https://inari.jp/en/',
        },
        {
          tabId: 't-4',
          favicon: '',
          title: 'Settings',
          url: 'chrome://settings/downloads',
        },
      ],
      chromeTabGroups: [{ groupId: 'g-1', title: 'Flights', color: 'blue' }],
    },
  ],
});

const WEB_URLS = [
  'https://www.jr-central.co.jp/en/nozomi/',
  'https://www.westjr.co.jp/global/en/ticket/haruka/',
  'https://inari.jp/en/',
];

const EXPORT_ITEM = 'Export as PDF / web page';

/**
 * Export lives in the session header's More actions menu (KAN-193), so every
 * export starts by opening that menu. Returns once the item is clicked, so it
 * can sit inside the Promise.all that waits for the new tab.
 */
async function chooseExport(popup: Page) {
  await popup.getByRole('button', { name: 'More actions' }).click();
  await popup.getByRole('menuitem', { name: EXPORT_ITEM }).click();
}

/** The popup, with one session seeded and selected. */
async function openPopup(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
) {
  await seedSessions(context, {
    ...buildContainer([KYOTO]),
    selectedTabGroupId: 'session-kyoto',
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(
    page.getByRole('button', { name: 'More actions' })
  ).toBeVisible();
  return page;
}

test.describe('exporting a session as a web page', () => {
  test('the icon opens a preview of the file, and Save writes it', async ({
    context,
    extensionId,
  }) => {
    const popup = await openPopup(context, extensionId);

    const [exportPage] = await Promise.all([
      context.waitForEvent('page'),
      chooseExport(popup),
    ]);
    await exportPage.waitForLoadState();

    expect(exportPage.url()).toContain('export.html');
    expect(exportPage.url()).toContain('session=session-kyoto');
    await expect(exportPage.getByText('Weekend in Kyoto')).toBeVisible();

    // The preview is the file itself, in its own document.
    const preview = exportPage.frameLocator('iframe');
    await expect(
      preview.getByRole('link', { name: 'Nozomi timetable' })
    ).toBeVisible();
    await expect(preview.getByText('Flights')).toBeVisible();
    // The chrome:// tab is there, and is not a link.
    await expect(preview.getByText('Settings', { exact: true })).toBeVisible();
    await expect(preview.getByRole('link', { name: 'Settings' })).toHaveCount(
      0
    );

    const [download] = await Promise.all([
      exportPage.waitForEvent('download'),
      exportPage.getByRole('button', { name: 'Save as HTML' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^Weekend in Kyoto - \d{4}-\d{2}-\d{2}\.html$/
    );

    const file = join(
      mkdtempSync(join(tmpdir(), 'tabkeeper-export-')),
      'saved.html'
    );
    await download.saveAs(file);
    const html = readFileSync(file, 'utf8');

    for (const url of WEB_URLS) expect(html).toContain(`href="${url}"`);
    expect(html).not.toContain('href="chrome://settings/downloads"');
    expect(html).toContain('Flights');
    expect(html).toContain('#8ab4f8');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('ref=export');
  });

  test('the layout switch changes the file, and is remembered', async ({
    context,
    extensionId,
  }) => {
    const popup = await openPopup(context, extensionId);
    const [exportPage] = await Promise.all([
      context.waitForEvent('page'),
      chooseExport(popup),
    ]);
    await exportPage.waitForLoadState();

    const preview = exportPage.frameLocator('iframe');
    // Comfortable shows the whole URL under each link.
    await expect(preview.getByText('https://inari.jp/en/')).toBeVisible();

    await exportPage.getByRole('button', { name: 'Compact' }).click();

    // Compact shows the site instead, while the link still goes to the page.
    await expect(preview.getByText('inari.jp', { exact: true })).toBeVisible();
    await expect(
      preview.getByRole('link', { name: 'Fushimi Inari' })
    ).toHaveAttribute('href', 'https://inari.jp/en/');
    await expect(
      exportPage.getByRole('button', { name: 'Compact' })
    ).toHaveAttribute('aria-pressed', 'true');

    // Reopening gets the layout that was chosen, because it was persisted.
    const [second] = await Promise.all([
      context.waitForEvent('page'),
      chooseExport(popup),
    ]);
    await second.waitForLoadState();
    await expect(
      second.getByRole('button', { name: 'Compact' })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('the saved file opens from disk and fetches nothing', async ({
    context,
    extensionId,
  }) => {
    const popup = await openPopup(context, extensionId);
    const [exportPage] = await Promise.all([
      context.waitForEvent('page'),
      chooseExport(popup),
    ]);
    await exportPage.waitForLoadState();
    const [download] = await Promise.all([
      exportPage.waitForEvent('download'),
      exportPage.getByRole('button', { name: 'Save as HTML' }).click(),
    ]);
    const file = join(
      mkdtempSync(join(tmpdir(), 'tabkeeper-export-')),
      'saved.html'
    );
    await download.saveAs(file);

    const reader = await context.newPage();
    const requested: string[] = [];
    reader.on('request', (request) => requested.push(request.url()));
    await reader.goto(`file://${file}`);
    await reader.waitForLoadState('networkidle');

    // Every tab is there, and the three web ones are links.
    await expect(
      reader.getByRole('link', { name: 'Fushimi Inari' })
    ).toBeVisible();
    expect(await reader.getByRole('link').count()).toBe(WEB_URLS.length + 1); // + the store link
    await expect(reader.getByText('Settings', { exact: true })).toBeVisible();

    // CONTROL: the page was really loaded, so "no requests" is not vacuous.
    expect(
      requested.filter((url) => url.startsWith('file://'))
    ).not.toHaveLength(0);
    expect(
      requested.filter((url) => url.startsWith('http')),
      'the file must not reach the network when it is opened'
    ).toEqual([]);
  });
});

// "Save as PDF" is the browser's print dialog pointed at the same document,
// so the PDF must be the file: same links, same structure, nothing lost.
// Chrome writes anchors as /URI annotations, which is what makes a printed
// link still clickable -- and what this reads back out of the real PDF.
test('the printed PDF keeps every link the file has, and no others', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);
  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    chooseExport(popup),
  ]);
  await exportPage.waitForLoadState();
  const [download] = await Promise.all([
    exportPage.waitForEvent('download'),
    exportPage.getByRole('button', { name: 'Save as HTML' }).click(),
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'tabkeeper-export-'));
  const file = join(dir, 'saved.html');
  await download.saveAs(file);

  const reader = await context.newPage();
  await reader.goto(`file://${file}`);
  const pdfPath = join(dir, 'saved.pdf');
  await reader.pdf({ path: pdfPath });
  const pdf = readFileSync(pdfPath, 'latin1');

  // CONTROL: the PDF carries link annotations at all, so the assertions below
  // are about WHICH links rather than about a PDF with none.
  expect(pdf).toContain('/URI');

  for (const url of WEB_URLS) {
    expect(pdf, `${url} should still be clickable in the PDF`).toContain(url);
  }
  // The store link travels too -- it is how a shared file is attributed.
  expect(pdf).toContain('ref=export');
  // And the tab that is not a web link did not become one on paper either.
  expect(pdf).not.toContain('chrome://settings/downloads');
});

test('the file can be switched light or dark, and printed', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);
  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    chooseExport(popup),
  ]);
  await exportPage.waitForLoadState();

  // The default follows the Light theme these fixtures run under.
  const body = exportPage.frameLocator('iframe').locator('body');
  await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  await exportPage.getByRole('button', { name: 'Dark' }).click();
  await expect(body).toHaveCSS('background-color', 'rgb(23, 25, 29)');
  await expect(
    exportPage.getByRole('button', { name: 'Dark' })
  ).toHaveAttribute('aria-pressed', 'true');

  // Printing is what "Save as PDF" is: the browser's own dialog, opened on the
  // previewed document.
  //
  // The first version of this test replaced window.print INSIDE the frame and
  // asserted the replacement ran. That passed against a build where printing
  // was impossible: a sandboxed frame without allow-modals ignores print()
  // outright, and Chrome says so in the console rather than throwing. So the
  // console is what this reads.
  const ignored: string[] = [];
  exportPage.on('console', (message) => {
    if (message.text().includes("Ignored call to 'print()'")) {
      ignored.push(message.text());
    }
  });

  await exportPage.getByRole('button', { name: 'PDF / Print' }).click();
  await exportPage.waitForTimeout(500);

  expect(ignored, 'the frame must be allowed to open the print dialog').toEqual(
    []
  );
});

// The toolbar wrapped onto a second line before it was grouped, and nothing
// failed -- wrapping is silent. Wrapping itself is fine at a narrow width;
// what is not fine is a JOINED PAIR splitting across two lines, which turns a
// segmented control into two orphaned buttons, or a row cut off rather than
// wrapped.
for (const width of [1200, 800, 480]) {
  test(`at ${width}px the joined pairs stay whole and nothing is clipped`, async ({
    context,
    extensionId,
  }) => {
    const popup = await openPopup(context, extensionId);
    const [exportPage] = await Promise.all([
      context.waitForEvent('page'),
      chooseExport(popup),
    ]);
    await exportPage.waitForLoadState();
    await exportPage.setViewportSize({ width, height: 600 });

    const shape = await exportPage.evaluate(() => {
      const linesIn = (el: Element) =>
        new Set(
          [...el.querySelectorAll('button')].map((b) =>
            Math.round(b.getBoundingClientRect().top)
          )
        ).size;
      const groups = [...document.querySelectorAll('[role="group"]')];
      const bar = document.querySelector('button')!.closest('div')!
        .parentElement!;
      return {
        groups: groups.length,
        splitGroups: groups.filter((group) => linesIn(group) > 1).length,
        clipped: bar.scrollWidth > bar.clientWidth + 1,
        buttons: document.querySelectorAll('button').length,
      };
    });

    expect(shape.buttons, 'two choices plus three actions').toBe(7);
    expect(shape.groups, 'layout and colour').toBe(2);
    expect(
      shape.splitGroups,
      'a joined pair may never break across lines'
    ).toBe(0);
    expect(shape.clipped, 'nothing is cut off horizontally').toBe(false);
  });
}

// German is where a toolbar of English labels falls over: "Alle Links
// kopieren" and "Als HTML speichern" are half again as long. The popup is in
// German too, so this cannot reuse openPopup, which waits for the English
// name -- the first version did, and failed there rather than on the toolbar.
test('the toolbar survives German at the popup width', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, {
    language: 'de',
    isNeverAskAgainForTabGroups: true,
    isNeverAskAgainToRate: true,
  });
  await seedSessions(context, {
    ...buildContainer([KYOTO]),
    selectedTabGroupId: 'session-kyoto',
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  const moreActions = popup.getByRole('button', { name: 'Weitere Aktionen' });
  await expect(moreActions).toBeVisible();
  await moreActions.click();

  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    popup
      .getByRole('menuitem', { name: 'Als PDF / Webseite exportieren' })
      .click(),
  ]);
  await exportPage.waitForLoadState();
  await exportPage.setViewportSize({ width: 800, height: 600 });

  await expect(exportPage.getByRole('group', { name: 'Layout' })).toBeVisible();
  await expect(exportPage.getByRole('group', { name: 'Farbe' })).toBeVisible();
  await expect(
    exportPage.getByRole('button', { name: 'Als HTML speichern' })
  ).toBeVisible();

  const shape = await exportPage.evaluate(() => {
    const linesIn = (el: Element) =>
      new Set(
        [...el.querySelectorAll('button')].map((b) =>
          Math.round(b.getBoundingClientRect().top)
        )
      ).size;
    const groups = [...document.querySelectorAll('[role="group"]')];
    const bar = document.querySelector('button')!.closest('div')!
      .parentElement!;
    return {
      splitGroups: groups.filter((group) => linesIn(group) > 1).length,
      clipped: bar.scrollWidth > bar.clientWidth + 1,
    };
  });

  expect(shape.splitGroups, 'longer labels must not split a pair').toBe(0);
  expect(shape.clipped, 'German must wrap rather than be cut off').toBe(false);
});

// Icon carries 4px of its own padding and Button adds 8px to its right, so
// the gap LEFT of the icon was wider than the gap right of the label. Measured
// in the real browser, because this is geometry.
test('an icon button is evenly padded on both sides', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);
  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    chooseExport(popup),
  ]);
  await exportPage.waitForLoadState();

  const gaps = await exportPage.evaluate(() => {
    const measure = (name: string) => {
      const button = [...document.querySelectorAll('button')].find(
        (b) => b.getAttribute('aria-label') === name
      )!;
      const box = button.getBoundingClientRect();
      const glyph = button
        .querySelector('.material-symbols-outlined')!
        .getBoundingClientRect();
      // The LABEL is the button's last direct child; the glyph is a span
      // nested inside the icon, and a plain span selector finds that first.
      const label = [...button.children]
        .filter((child) => child.tagName === 'SPAN')
        .pop()!
        .getBoundingClientRect();
      return {
        left: Math.round(glyph.left - box.left),
        right: Math.round(box.right - label.right),
      };
    };
    return ['PDF / Print', 'Copy all links', 'Save as HTML'].map((name) => ({
      name,
      ...measure(name),
    }));
  });

  for (const gap of gaps) {
    expect(
      Math.abs(gap.left - gap.right),
      `${gap.name}: ${gap.left}px before the icon, ${gap.right}px after the label`
    ).toBeLessThanOrEqual(1);
  }
});

// The "Links copied" toast was a block in the flow, so showing it pushed the
// whole preview down and pulled it back up two seconds later. A confirmation
// must not move what it confirms.
test('the copied toast does not move the page', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);
  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    chooseExport(popup),
  ]);
  await exportPage.waitForLoadState();
  await exportPage.context().grantPermissions(['clipboard-write']);

  const frame = exportPage.locator('iframe');
  const before = await frame.boundingBox();

  await exportPage.getByRole('button', { name: 'Copy all links' }).click();
  await expect(exportPage.getByText('Links copied')).toBeVisible();

  const during = await frame.boundingBox();
  expect(during!.y, 'the preview must not move when the toast appears').toBe(
    before!.y
  );
  expect(during!.height, 'nor shrink to make room for it').toBe(before!.height);
});

// In the compact layout the site sits at the right end of each row, and the
// group block had padding on its left only -- so inside a group the text
// touched the block's edge. Measured in the rendered file, because this is
// about painted boxes, not about a rule existing.
test('compact rows keep a gap from the edge of a group block', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);
  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    chooseExport(popup),
  ]);
  await exportPage.waitForLoadState();
  await exportPage.getByRole('button', { name: 'Compact' }).click();

  const preview = exportPage.frameLocator('iframe');
  await expect(preview.getByText('Flights')).toBeVisible();

  const gaps = await exportPage
    .frameLocator('iframe')
    .locator('body')
    .evaluate(() => {
      const group = document.querySelector('.group')!;
      const groupBox = group.getBoundingClientRect();
      return [...group.querySelectorAll('li.tab .url')].map((url) =>
        Math.round(groupBox.right - url.getBoundingClientRect().right)
      );
    });

  expect(
    gaps.length,
    'the sample session has a group with tabs'
  ).toBeGreaterThan(0);
  for (const gap of gaps) {
    expect(
      gap,
      'the site must not touch the block edge'
    ).toBeGreaterThanOrEqual(6);
  }
});

// KAN-192. The PDF did not look like the HTML. The print rules added in
// KAN-190 deliberately changed paper from screen -- underlined links, a
// replacement palette, groups without their tint, no body padding -- and the
// unit tests asserted those rules, so they locked the difference in.
//
// The requirement is that the PDF IS the file. Printing is the file under
// print media, so the strongest statement available in a browser is: the same
// saved file, rendered under print media, is pixel-identical to it on screen.
// Checked for both layouts and both colour schemes, because each carries its
// own rules.
for (const layout of ['Comfortable', 'Compact'] as const) {
  for (const scheme of ['Light', 'Dark'] as const) {
    test(`${layout}, ${scheme}: the file prints exactly as it looks`, async ({
      context,
      extensionId,
    }) => {
      const popup = await openPopup(context, extensionId);
      const [exportPage] = await Promise.all([
        context.waitForEvent('page'),
        chooseExport(popup),
      ]);
      await exportPage.waitForLoadState();
      await exportPage.getByRole('button', { name: layout }).click();
      await exportPage.getByRole('button', { name: scheme }).click();

      const [download] = await Promise.all([
        exportPage.waitForEvent('download'),
        exportPage.getByRole('button', { name: 'Save as HTML' }).click(),
      ]);
      const file = join(
        mkdtempSync(join(tmpdir(), 'tabkeeper-print-')),
        'saved.html'
      );
      await download.saveAs(file);

      const reader = await context.newPage();
      await reader.setViewportSize({ width: 816, height: 1056 });
      await reader.goto(`file://${file}`);

      await reader.emulateMedia({ media: 'screen' });
      const onScreen = await reader.screenshot({ fullPage: true });
      await reader.emulateMedia({ media: 'print' });
      const inPrint = await reader.screenshot({ fullPage: true });

      // CONTROL: the two renders are of a real page, not two blank frames that
      // would be "identical" for free.
      expect(onScreen.length).toBeGreaterThan(5000);
      expect(
        inPrint.equals(onScreen),
        'print media must not change a single pixel of the file'
      ).toBe(true);

      // What a screenshot cannot show, read from the browser instead:
      // backgrounds must print even with "Background graphics" off, and the
      // page must leave Chrome no margin to draw its header and footer into.
      const print = await reader.evaluate(() => {
        const pageRules = [...document.styleSheets]
          .flatMap((sheet) => [...sheet.cssRules])
          .filter((rule): rule is CSSPageRule => rule instanceof CSSPageRule);
        return {
          pageMargin: pageRules.map((rule) => rule.style.margin),
          colourAdjust: getComputedStyle(document.body).printColorAdjust,
          // By name: TypeScript's CSSStyleDeclaration does not list this
          // property, and a cast would claim a type the DOM lib does not have.
          breaks: getComputedStyle(
            document.querySelector('main')!
          ).getPropertyValue('box-decoration-break'),
        };
      });
      expect(
        print.pageMargin,
        'no margin for a browser header or footer'
      ).toContain('0px');
      expect(print.colourAdjust, 'tints print without ticking a box').toBe(
        'exact'
      );
      expect(
        print.breaks,
        'every page keeps the top and bottom padding, not just the first'
      ).toBe('clone');
    });
  }
}

// KAN-193. OverflowMenu's own docs warn that inside a stacking context the
// menu paints BEHIND later positioned siblings -- invisible to jsdom, which
// computes no paint order. The session menu drops down over the tab list, so
// this asks the browser what is actually under the pointer at each item.
test('the session menu paints above the tab rows it opens over', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);
  await popup.getByRole('button', { name: 'More actions' }).click();

  const items = popup.getByRole('menuitem');
  await expect(items).toHaveCount(2);

  const hits = await items.evaluateAll((elements) =>
    elements.map((item) => {
      const box = item.getBoundingClientRect();
      const top = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2
      );
      return {
        name: item.textContent?.trim(),
        onTop: top !== null && item.contains(top),
      };
    })
  );

  // CONTROL: the menu really does overlap the tab list, so "on top" is not
  // true merely because nothing else is there.
  const overlaps = await popup.evaluate(() => {
    const menu = document
      .querySelector('[role="menu"]')!
      .getBoundingClientRect();
    const list = document
      .querySelector('[data-window-tabs]')!
      .getBoundingClientRect();
    return menu.bottom > list.top;
  });
  expect(
    overlaps,
    'the menu must open over the tab list for this to mean anything'
  ).toBe(true);

  for (const hit of hits) {
    expect(hit.onTop, `${hit.name} must be the element under the pointer`).toBe(
      true
    );
  }
});

// KAN-193. The menu is anchored to its trigger's RIGHT edge, which suits a
// trigger at the end of a row (the tab group title) and not this one, near the
// start. Measured at the popup's size: the menu opened leftward across the
// pane divider, over the session list, and "Export as PDF / web page" wrapped
// onto two lines -- in German too. A menu that crosses into the neighbouring
// pane reads as detached from what opened it.
for (const lang of ['en', 'de'] as const) {
  test(`the session menu stays in its pane with each label on one line (${lang})`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, {
      language: lang,
      isNeverAskAgainForTabGroups: true,
      isNeverAskAgainToRate: true,
    });
    await seedSessions(context, {
      ...buildContainer([KYOTO]),
      selectedTabGroupId: 'session-kyoto',
    });
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 790, height: 550 });
    await popup.goto(`chrome-extension://${extensionId}/index.html`);

    const trigger = popup.getByRole('button', {
      name: lang === 'de' ? 'Weitere Aktionen' : 'More actions',
    });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(popup.getByRole('menu')).toBeVisible();

    const shape = await trigger.evaluate((triggerEl) => {
      // The pane is the nearest ancestor of the trigger that also holds the
      // header's "Add current window" control on the far side.
      let pane: Element | null = triggerEl;
      while (
        pane &&
        !pane.querySelector('button[aria-label]:not([aria-haspopup])')
      ) {
        pane = pane.parentElement;
      }
      while (
        pane &&
        pane.parentElement &&
        pane.getBoundingClientRect().width < 380
      ) {
        pane = pane.parentElement;
      }
      const paneBox = pane!.getBoundingClientRect();
      const menuBox = document
        .querySelector('[role="menu"]')!
        .getBoundingClientRect();
      const heights = [...document.querySelectorAll('[role="menuitem"]')].map(
        (item) => Math.round(item.getBoundingClientRect().height)
      );
      return {
        paneLeft: Math.round(paneBox.left),
        paneRight: Math.round(paneBox.right),
        menuLeft: Math.round(menuBox.left),
        menuRight: Math.round(menuBox.right),
        heights,
      };
    });

    // CONTROL: this measured a pane, not the whole popup, so "inside" can fail.
    expect(shape.paneRight - shape.paneLeft).toBeLessThan(600);

    expect(
      shape.menuLeft,
      `the menu starts at ${shape.menuLeft}px, left of its pane at ${shape.paneLeft}px`
    ).toBeGreaterThanOrEqual(shape.paneLeft);
    expect(shape.menuRight).toBeLessThanOrEqual(shape.paneRight);
    expect(
      new Set(shape.heights).size,
      `item heights ${shape.heights.join('/')}px: a label wrapped`
    ).toBe(1);
  });
}
