import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { localeStrings } from './fixtures/locales';
import { rgb } from './fixtures/pixels';
import { CHALK_THEME, CHARCOAL_THEME } from '../src/hooks/useThemeColors';

// KAN-826. The preview is a sheet on the page's ground, and a pointer beside
// it shows Save as PDF… until this device first presses it.
// KAN-880: the toolbar is the sheet's width, so Save as PDF… ends on the
// sheet's edge and the tip may sit right of the button's middle (to 3/4 along).

const SESSION = buildSession({
  tabGroupId: 'session-pointer',
  title: 'Pointer session',
  isSelected: true,
});
const WIDE = { width: 1280, height: 760 };
const URL_PATH = 'export.html?session=session-pointer';

async function seed(context: BrowserContext, settings = {}) {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-pointer',
  });
  await seedSettings(context, { theme: 'Chalk', ...settings });
}

async function openExport(
  context: BrowserContext,
  extensionId: string,
  viewport = WIDE
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${URL_PATH}`);
  await expect(page.locator('[data-toolbar-row]')).toBeVisible();
  await expect(page.locator('iframe')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const pointer = (page: Page) => page.locator('[data-save-pdf-pointer]');

/** The pointer's line in document coordinates, against the boxes it is measured from. */
const aim = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector('[data-save-pdf-pointer]');
    const line = svg?.querySelector('path');
    if (!(line instanceof SVGPathElement)) return null;
    const doc = (r: DOMRect) => ({
      left: r.left + scrollX,
      right: r.right + scrollX,
      top: r.top + scrollY,
      bottom: r.bottom + scrollY,
    });
    const sheet = doc(
      document.querySelector('iframe')!.getBoundingClientRect()
    );
    // Save as PDF… ends the row, in every language.
    const buttons = document.querySelectorAll('[data-toolbar-row] button');
    const button = doc(buttons[buttons.length - 1]!.getBoundingClientRect());
    const total = line.getTotalLength();
    const points = Array.from({ length: Math.ceil(total / 4) + 1 }, (_, i) =>
      line.getPointAtLength(Math.min(i * 4, total))
    );
    const tip = points[points.length - 1]!;
    const width = button.right - button.left;
    return {
      tip: { x: tip.x, y: tip.y },
      // From the button's middle to 3/4 along it (TIP_LAST_ALONG), 8px under it.
      target: {
        fromX: button.left + width / 2,
        toX: button.left + width * 0.75,
        y: button.bottom + 8,
      },
      // Off the file: right of the sheet, or above it.
      offSheet: points.every((p) => p.x > sheet.right || p.y < sheet.top),
      stroke: getComputedStyle(svg!).stroke,
      color: getComputedStyle(svg!).color,
    };
  });

type Aim = NonNullable<Awaited<ReturnType<typeof aim>>>;
const onTarget = (a: Aim) =>
  a.tip.x >= a.target.fromX - 2 &&
  a.tip.x <= a.target.toX + 2 &&
  Math.abs(a.tip.y - a.target.y) <= 2;

/** The aim once the tip rests on the button: the observer re-aims a frame after a box changes. */
async function settledAim(page: Page): Promise<Aim> {
  let last: Aim | null = null;
  await expect
    .poll(
      async () => {
        last = await aim(page);
        return last !== null && onTarget(last);
      },
      { message: 'the tip comes to rest under Save as PDF…' }
    )
    .toBe(true);
  return last!;
}

// Print stubbed in the frame that has the icons; it counts presses.
async function stubPrint(page: Page) {
  await expect(
    page.frameLocator('iframe').locator('[data-icons="ready"]')
  ).toHaveCount(1);
  await page.evaluate(() => {
    const w = window as unknown as { printed: number };
    w.printed = 0;
    document.querySelector('iframe')!.contentWindow!.print = () => {
      w.printed++;
    };
  });
}
const printed = (page: Page) =>
  page.evaluate(() => (window as unknown as { printed: number }).printed);

for (const [theme, colors] of [
  ['Chalk', CHALK_THEME],
  ['Charcoal', CHARCOAL_THEME],
] as const) {
  test(`at 1280px the preview is an 816px sheet 36px under the toolbar, on the SECONDARY ground (${theme})`, async ({
    context,
    extensionId,
  }) => {
    await seed(context, { theme });
    const page = await openExport(context, extensionId);

    const g = await page.evaluate(() => {
      const row = document.querySelector('[data-toolbar-row]')!;
      const header = row.parentElement!;
      const label = header.nextElementSibling!;
      const sheet = document.querySelector('iframe')!.getBoundingClientRect();
      return {
        width: sheet.width,
        gap: sheet.top - row.getBoundingClientRect().bottom,
        underLabel: sheet.top - label.getBoundingClientRect().bottom,
        label: label.textContent,
        header: getComputedStyle(header).backgroundColor,
        ground: getComputedStyle(
          document.querySelector('iframe')!.parentElement!
        ).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        root: getComputedStyle(document.documentElement).backgroundColor,
      };
    });
    expect(g.width).toBe(816);
    // KAN-880. The mode label sits between them, 4px over the sheet.
    expect(g.gap).toBeCloseTo(36, 0);
    expect(g.label).toBe('Preview');
    expect(g.underLabel).toBeCloseTo(4, 0);
    // No band (KAN-880): the header lies on the ground, out to the overscroll gutter.
    expect(g.header).toBe('rgba(0, 0, 0, 0)');
    expect(g.ground).toBe(rgb(colors.SECONDARY_COLOR));
    expect(g.body).toBe(g.ground);
    expect(g.root).toBe(g.ground);
  });
}

test('the pointer starts right of the sheet and ends under Save as PDF…', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await openExport(context, extensionId);

  await expect(pointer(page)).toHaveCount(1);
  const a = await settledAim(page);
  expect(a.offSheet, JSON.stringify(a)).toBe(true);
  await expect(pointer(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(pointer(page)).toHaveCSS('pointer-events', 'none');
});

// Save as PDF… ends on the sheet's edge at every width, so a language whose
// longer label pushed every tip over the file would never get the pointer:
// it must be drawn in every one (spec call 13: it never quietly disappears).
for (const language of [
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
]) {
  test(`at 1280px the pointer shows off the sheet, on Save as PDF… (${language})`, async ({
    context,
    extensionId,
  }) => {
    await seed(context, { language });
    const page = await openExport(context, extensionId);
    await expect(pointer(page), 'the pointer is drawn').toHaveCount(1);
    const a = await settledAim(page);
    expect(a.offSheet, JSON.stringify(a)).toBe(true);
  });
}

test('below 90px of room there is no pointer, and it comes back with room', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await openExport(context, extensionId, {
    width: 900,
    height: 760,
  });
  await expect(page.locator('iframe')).toBeVisible();
  await expect(pointer(page)).toHaveCount(0);

  // CONTROL: the same page with room draws it.
  await page.setViewportSize(WIDE);
  await expect(pointer(page)).toHaveCount(1);
  await settledAim(page);
});

test('pressing Save as PDF… ends the pointer here for good', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await openExport(context, extensionId);
  // CONTROL: before any press, a second export tab shows it too.
  const before = await openExport(context, extensionId);
  await expect(pointer(before)).toHaveCount(1);
  await before.close();

  await stubPrint(page);
  await page.getByRole('button', { name: 'Save as PDF…' }).click();
  await expect.poll(() => printed(page)).toBe(1);
  await expect(pointer(page)).toHaveCount(0);

  const after = await openExport(context, extensionId);
  await expect(after.locator('iframe')).toBeVisible();
  await expect(pointer(after)).toHaveCount(0);
});

test('a press in one export tab ends the pointer in the other', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const first = await openExport(context, extensionId);
  const second = await openExport(context, extensionId);
  await expect(pointer(second)).toHaveCount(1);

  await first.bringToFront();
  await stubPrint(first);
  await first.getByRole('button', { name: 'Save as PDF…' }).click();

  await expect(pointer(second)).toHaveCount(0);
});

// Review Focus 1. Chrome's font size Large: the toolbar grows and may wrap.
test('at a 20px root the tip is under Save as PDF…, or there is no pointer', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await openExport(context, extensionId);
  // PREMISE: at the default size it is there, so "no pointer" below is the root's doing.
  await expect(pointer(page)).toHaveCount(1);
  await page.addStyleTag({ content: 'html{font-size:20px}' });
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize
    )
  ).toBe('20px');
  // Let the observers deliver the new boxes.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );

  const a = await aim(page);
  console.log(`20px root: ${a ? 'pointer' : 'no pointer'}`);
  if (a) {
    expect((await settledAim(page)).offSheet, JSON.stringify(a)).toBe(true);
  }
});

// Review Focus 2. A short window where the page scrolls. The sheet grows to
// fill the window, so only below ~280px high is there anything to scroll.
test('measured while the page is scrolled, the tip stays under Save as PDF…', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await openExport(context, extensionId, {
    width: 1280,
    height: 240,
  });
  await expect(pointer(page)).toHaveCount(1);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  // A resize while scrolled makes the pointer measure again, at this scroll.
  await page.setViewportSize({ width: 1300, height: 240 });
  // PREMISE: the page really is scrolled as it measures.
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await settledAim(page);
});

// Review Focus 3. Language and colour changed from elsewhere while open.
test('a language change from another page re-aims it, and Dark recolours it', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await openExport(context, extensionId);
  const english = await settledAim(page);

  // Another extension page writes the setting, as Settings in the popup does.
  const other = await context.newPage();
  await other.goto(`chrome-extension://${extensionId}/manifest.json`);
  await other.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('settingsData') ?? '{}');
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ ...settings, language: 'ru' })
    );
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe('ru');
  // The button widens first; the observer re-aims in the frame after.
  await expect
    .poll(async () => {
      const a = await aim(page);
      return (
        a !== null &&
        Math.abs(a.target.fromX - english.target.fromX) > 1 &&
        onTarget(a)
      );
    })
    .toBe(true);

  await page
    .getByRole('button', { name: localeStrings('ru')['Dark'], exact: true })
    .click();
  await expect(pointer(page)).toHaveCSS(
    'color',
    rgb(CHARCOAL_THEME.LABEL_L1_COLOR)
  );
});

// CDP keys never reach Chrome's own shortcuts, so this proves the page's side:
// the press prints and is prevented. What a real ⌘P does was measured headed
// with OS keys (KAN-826 Task 1).
for (const where of ['the page', 'the preview'] as const) {
  test(`ControlOrMeta+P with focus in ${where} runs Save as PDF… and keeps the browser away`, async ({
    context,
    extensionId,
  }) => {
    await seed(context);
    const page = await openExport(context, extensionId);
    await stubPrint(page);
    if (where === 'the preview') {
      const box = (await page.locator('iframe').boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + 200);
      expect(
        await page.evaluate(
          () => document.activeElement === document.querySelector('iframe')
        )
      ).toBe(true);
    }
    // Added after the app's listeners, so it reads what they did.
    await page.evaluate((where) => {
      const w = window as unknown as { prevented: boolean[] };
      w.prevented = [];
      const target =
        where === 'the page'
          ? window
          : document.querySelector('iframe')!.contentDocument!;
      // The modifier's own keydown comes first and is left alone.
      target.addEventListener('keydown', (e) => {
        // Not instanceof: the frame's events come from the frame's realm.
        if ('code' in e && e.code === 'KeyP') {
          w.prevented.push(e.defaultPrevented);
        }
      });
    }, where);

    await page.keyboard.press('ControlOrMeta+P');

    await expect.poll(() => printed(page)).toBe(1);
    expect(
      await page.evaluate(
        () => (window as unknown as { prevented: boolean[] }).prevented
      )
    ).toEqual([true]);
    await expect(pointer(page)).toHaveCount(0);
  });
}
