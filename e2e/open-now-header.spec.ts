import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { elementLanded } from './fixtures/landed';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { FULL, FULL_VIEW_PATH, openPage } from './fixtures/onboarding';
import { savedWindow, session } from './fixtures/savedWindows';
import { standIn } from './fixtures/standInPages';
import { ON_TITLE } from './fixtures/savedRow';
import { contrast, pixelsAt, rgbToHex } from './fixtures/pixels';

// KAN-576 and KAN-577 (pick A, icon arrow_back). Open now's header beside a selected session's, on the built artifact.
// KAN-578. Seeded answered (ONBOARDING_ANSWERED), so a press acts at once; the card's own tests seed it unanswered.
test.beforeEach(async ({ context }) => {
  await seedSettings(context, {});
});
const openNowHeader = (page: Page) => page.locator('[data-open-now-header]');
const chip = (page: Page) =>
  openNowHeader(page).getByRole('button', {
    name: 'Back to your tab',
    exact: true,
  });

// Default view Full, as the page's setting and the worker's store both hold it (open-in-popup.spec's recipe).
async function defaultViewFull(context: BrowserContext, worker: Worker) {
  await seedSettings(context, { defaultView: 'full' });
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ defaultView: 'full' });
    const applied: unknown = Reflect.get(
      globalThis,
      'tabKeeperDefaultViewApplied'
    );
    if (typeof applied !== 'function')
      throw new Error('no tabKeeperDefaultViewApplied');
    await applied();
  });
}

// A page to come back to, made active, then the full view opened from it.
async function fullViewFrom(
  context: BrowserContext,
  worker: Worker,
  extensionId: string
) {
  const from = await worker.evaluate(async (url) => {
    const tab = await chrome.tabs.create({ url, active: true });
    return tab.id ?? -1;
  }, standIn('Quarterly plan'));
  await expect
    .poll(() =>
      worker.evaluate((id) => chrome.tabs.get(id).then((t) => t.status), from)
    )
    .toBe('complete');
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  return { page, from };
}

const activeTabId = (worker: Worker) =>
  worker.evaluate(async () => {
    const [win] = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    return tab?.id ?? -1;
  });

const styleOf = (target: Locator) =>
  target.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, color: s.color, fontFamily: s.fontFamily };
  });

async function cornerGap(target: Locator, box: Locator) {
  const [t, b] = [await target.boundingBox(), await box.boundingBox()];
  if (t === null || b === null) throw new Error('no box');
  return {
    right: Math.round((b.x + b.width - (t.x + t.width)) * 64) / 64,
    bottom: Math.round((b.y + b.height - (t.y + t.height)) * 64) / 64,
    height: t.height,
  };
}

test("the title is the session title's size and colour, and Back sits in Add window's corner", async ({
  context,
  extensionId,
}) => {
  await seedSessions(
    context,
    buildContainer([
      session('S1', 'Q4 product roadmap', [savedWindow('w1', '', 2)]),
    ])
  );
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  await page
    .getByRole('button', { name: 'Q4 product roadmap' })
    .first()
    .click(ON_TITLE);
  const sessionTitle = page
    .locator('[data-tour-anchor="title"]')
    .getByText('Q4 product roadmap', { exact: true });
  await expect(sessionTitle).toBeVisible();

  expect(
    await styleOf(page.getByRole('heading', { name: 'Currently open' }))
  ).toEqual(await styleOf(sessionTitle));

  const addWindow = page.getByRole('button', {
    name: 'Add current window',
    exact: true,
  });
  const addHeader = page
    .locator('[data-tour-anchor="title"]')
    .locator(
      'xpath=ancestor::*[.//button[@aria-label="Add current window"]][1]'
    );
  const want = await cornerGap(addWindow, addHeader);
  const got = await cornerGap(chip(page), openNowHeader(page));
  console.log('[KAN-577 corner]', JSON.stringify({ want, got }));
  expect(got).toEqual(want);
});

// KAN-686 (pick A). Open now's header wears the saved session header's fill, read off the paint.
for (const theme of ['Light', 'Darkenheimer'] as const) {
  test(`${theme}: Open now's header has the session header's fill, and its faintest text stays legible`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    await seedSessions(
      context,
      buildContainer([
        session('S1', 'Q4 product roadmap', [savedWindow('w1', '', 2)]),
      ])
    );
    const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
    await page
      .getByRole('button', { name: 'Q4 product roadmap' })
      .first()
      .click(ON_TITLE);
    const updates = openNowHeader(page).getByText('Updates as you browse', {
      exact: true,
    });
    await expect(updates).toBeVisible();
    const sessionHeader = page
      .locator('[data-tour-anchor="title"]')
      .locator(
        'xpath=ancestor::*[.//button[@aria-label="Add current window"]][1]'
      );
    await page.mouse.move(0, 0);
    // Just inside each header's top-right corner, where neither draws text or a control.
    const corner = async (box: Locator): Promise<[number, number]> => {
      const b = await box.boundingBox();
      if (b === null) throw new Error('no box');
      return [b.x + b.width - 6, b.y + 6];
    };
    const [openNow, saved] = await pixelsAt(page, [
      await corner(openNowHeader(page)),
      await corner(sessionHeader),
    ]);
    // CONTROL: the decode is faithful, the session header painting its computed fill.
    expect(saved).toBe(
      rgbToHex(
        await sessionHeader.evaluate(
          (el) => getComputedStyle(el).backgroundColor
        )
      )
    );
    expect(openNow).toBe(saved);
    const text = rgbToHex(
      await updates.evaluate((el) => getComputedStyle(el).color)
    );
    expect(contrast(text, openNow)).toBeGreaterThanOrEqual(4.5);
  });
}

for (const view of ['compact', 'full'] as const) {
  test(`Default view ${view}: Open now's Back goes to the tab the full view was opened from`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    if (view === 'full') await defaultViewFull(context, serviceWorker);
    const { page, from } = await fullViewFrom(
      context,
      serviceWorker,
      extensionId
    );
    await expect(chip(page)).not.toHaveAttribute('aria-disabled');
    expect(await activeTabId(serviceWorker)).not.toBe(from);

    await chip(page).click();

    await expect.poll(() => activeTabId(serviceWorker)).toBe(from);
  });
}

// KAN-578. Unanswered, the chip asks first; the card's Go back goes back and closes the full view.
test("Open now's Back asks first; Go back goes back and closes the full view", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedSettings(context, { isClosesThisTabCardAnswered: false });
  const { page, from } = await fullViewFrom(
    context,
    serviceWorker,
    extensionId
  );
  await expect(chip(page)).not.toHaveAttribute('aria-disabled');

  await chip(page).click();
  const card = page.getByRole('dialog');
  await expect(card).toContainText(
    'Going back closes this tab. Pin it to keep it open.'
  );
  expect(await activeTabId(serviceWorker)).not.toBe(from);
  await card.getByRole('button', { name: 'Go back', exact: true }).click();

  await expect.poll(() => activeTabId(serviceWorker)).toBe(from);
  await expect.poll(() => page.isClosed()).toBe(true);
});

// Worst path: the longest label (ru, 321px) in the narrowest header: Open now
// at 340, side by side at 1100px (KAN-868; the drawer is 480 now). Cut with
// an ellipsis, never over the icons. In the drawer too, clear of the icons.
for (const [where, viewport, isCut] of [
  ['side by side at 340', { width: 1100, height: 768 }, true],
  ['in the drawer', { width: 1024, height: 768 }, null],
] as const) {
  test(`ru, ${where}: the chip shrinks clear of the icons, still in the corner`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, {
      foldSavedSessionInTabView: false,
      language: 'ru',
    });
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    await page.goto(`chrome-extension://${extensionId}/${FULL_VIEW_PATH}`);
    let header = page.locator('[data-pane="open-now"] [data-open-now-header]');
    if (isCut === null) {
      // The rail's one button (KAN-776: its text is now the glyph and a label).
      await page
        .locator('[data-pane="open-now"] button[aria-expanded]')
        .click();
      header = page.getByRole('dialog').locator('[data-open-now-header]');
      // KAN-810. The drawer slides in: measure it where it comes to rest.
      await elementLanded(page.getByRole('dialog'), 'subtree');
    } else {
      // PREMISE: Open now is at its narrowest.
      await expect
        .poll(async () =>
          Math.round(
            (await page.locator('[data-pane="open-now"]').boundingBox())
              ?.width ?? 0
          )
        )
        .toBe(340);
    }
    const back = header.getByRole('button', {
      name: 'Вернуться к вашей вкладке',
      exact: true,
    });
    await expect(back).toBeVisible();

    const m = await header.evaluate((el) => {
      // The action row's controls: KAN-784 put the drawer's close on the title line above it.
      const chip = [...el.querySelectorAll('[aria-label]')].pop()!;
      const controls = [...el.querySelectorAll('[aria-label]')].filter(
        (c) =>
          c.getBoundingClientRect().bottom > chip.getBoundingClientRect().top
      );
      const label = chip.querySelector(':scope > span:last-child');
      if (!(label instanceof HTMLElement)) throw new Error('no label');
      return {
        gap:
          chip.getBoundingClientRect().left -
          Math.max(
            ...controls.slice(0, -1).map((c) => c.getBoundingClientRect().right)
          ),
        cut: label.scrollWidth > label.clientWidth,
        ellipsis: getComputedStyle(label).textOverflow,
      };
    });
    console.log(`[KAN-868 ru ${where}] gap ${m.gap}px, cut ${m.cut}`);
    expect(m.gap).toBeGreaterThanOrEqual(8);
    if (isCut) expect(m.cut).toBe(true);
    expect(m.ellipsis).toBe('ellipsis');
    expect(await cornerGap(back, header)).toEqual({
      right: 1,
      bottom: 1,
      height: 32,
    });
  });
}
