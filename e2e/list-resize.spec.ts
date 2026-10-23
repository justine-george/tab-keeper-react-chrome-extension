import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession } from './fixtures/seed';

// KAN-687 on the real artifact: the saved list's width in the tab view.
// jsdom has no layout, so the pane widths, the grip in the gap, a real
// drag, a reload and the 480px floor beside the list are only provable here.
//
// Widths (paneWidths.ts): the list starts at a quarter of the window, 356 to
// 520 -- 360 at 1440, 480 at 1920, 356 at 1280 -- and drags from 356 to
// 600, or to what leaves the pane beside it 480px. Open now starts at an
// even split of what the list's default leaves: 540 at 1440, 720 at 1920.

const VIEW_TAB = 'index.html?view=tab';
const SESSIONS = '[data-pane="sessions"]';
const DETAIL = '[data-pane="detail"]';
const OPEN_NOW = '[data-pane="open-now"]';
const LIST_GRIP = '[data-list-resize-grip]';
const SEEDED_MARK = 'e2eListResizeSeeded';

const SESSION = buildSession({
  tabGroupId: 'list-resize',
  title: 'A session title long enough to show the list widen',
  isSelected: true,
  tabCount: 2,
  windows: [
    {
      windowId: 'w0',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'Saved window',
      tabs: [0, 1].map((i) => ({
        tabId: `saved-${i}`,
        favicon: '',
        title: `Saved tab ${i}`,
        url: `https://saved-${i}.test/`,
      })),
    },
  ],
});

// Seeds ONCE per profile: seed.ts's init scripts re-run on every reload and
// would put back the width a drag saved.
async function seedOnce(
  context: BrowserContext,
  settings: Record<string, unknown>
): Promise<void> {
  await context.addInitScript(
    ({ sessions, settings, mark }) => {
      try {
        if (window.localStorage.getItem(mark) !== null) return;
        const prior = window.localStorage.getItem('settingsData');
        const parsed: unknown = prior === null ? {} : JSON.parse(prior);
        const base =
          typeof parsed === 'object' && parsed !== null ? parsed : {};
        window.localStorage.setItem(
          'settingsData',
          JSON.stringify({ ...base, ...JSON.parse(settings) })
        );
        window.localStorage.setItem('tabContainerData', sessions);
        window.localStorage.setItem(mark, '1');
      } catch {
        // Storage blocked; the assertions say so more clearly.
      }
    },
    {
      sessions: JSON.stringify({
        ...buildContainer([SESSION]),
        selectedTabGroupId: SESSION.tabGroupId,
      }),
      settings: JSON.stringify({
        foldSavedSessionInTabView: false,
        ...settings,
      }),
      mark: SEEDED_MARK,
    }
  );
}

async function openPage(
  context: BrowserContext,
  extensionId: string,
  width: number
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/${VIEW_TAB}`);
  // goto resolves before React mounts.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

async function widthOf(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} is not drawn`);
  return Math.round(box.width);
}

const expectList = (page: Page, width: number) =>
  expect
    .poll(() => widthOf(page, SESSIONS), {
      message: `the list never became ${width}px wide`,
    })
    .toBe(width);

async function storedListWidth(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('settingsData');
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return typeof parsed === 'object' &&
      parsed !== null &&
      'listWidth' in parsed
      ? parsed.listWidth
      : null;
  });
}

async function gripCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(LIST_GRIP).boundingBox();
  if (box === null) throw new Error('no list grip');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// A real pointer drag on the grip, by dx px.
async function dragGrip(
  page: Page,
  dx: number,
  { release = true } = {}
): Promise<void> {
  const from = await gripCentre(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y, { steps: 12 });
  if (release) await page.mouse.up();
}

test.describe('resizing the saved list (KAN-687)', () => {
  test('1. the list starts at a quarter of the window, side by side and folded', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, 1440);
    await expectList(page, 360);
    expect(await widthOf(page, OPEN_NOW)).toBe(540);
    expect(await widthOf(page, DETAIL)).toBe(540);
    // KAN-747. The grip is centred in the gap: the list's own 8px padding, inside its right edge.
    const sessions = await page.locator(SESSIONS).boundingBox();
    const grip = await gripCentre(page);
    expect(
      Math.abs(grip.x - ((sessions?.x ?? 0) + (sessions?.width ?? 0) - 4))
    ).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1920, height: 800 });
    await expectList(page, 480);
    expect(await widthOf(page, OPEN_NOW)).toBe(720);

    await page
      .getByRole('button', { name: 'Fold the saved session away' })
      .click();
    await expect(page.locator(DETAIL)).toHaveCount(0);
    await expectList(page, 480);
    expect(await storedListWidth(page)).toBeNull();
  });

  test('2. a drag widens the list live, saves on release, and survives a reload', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, 1920);
    await expectList(page, 480);
    const nameBefore = await widthOf(
      page,
      'input[placeholder="Name the new session"]'
    );

    await dragGrip(page, 100, { release: false });
    await expectList(page, 580);
    // Mid-drag: nothing saved yet, and Open now has not moved.
    expect(await storedListWidth(page)).toBeNull();
    expect(await widthOf(page, OPEN_NOW)).toBe(720);
    await page.mouse.up();

    await expect.poll(() => storedListWidth(page)).toBe(580);
    // The header above the list widens with it.
    expect(
      await widthOf(page, 'input[placeholder="Name the new session"]')
    ).toBe(nameBefore + 100);
    expect(await widthOf(page, DETAIL)).toBe(1920 - 580 - 720);

    await page.reload();
    await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
    await expectList(page, 580);
  });

  test('3. the drag stops at 356 and where the saved session keeps its 480', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, 1440);
    await expectList(page, 360);
    const grip = page.getByRole('separator', {
      name: 'Resize the saved sessions list',
    });
    await expect(grip).toHaveAttribute('aria-valuemax', '420');

    await dragGrip(page, 300);
    await expectList(page, 420);
    expect(await widthOf(page, DETAIL)).toBe(480);
    expect(await widthOf(page, OPEN_NOW)).toBe(540);

    await dragGrip(page, -300);
    await expectList(page, 356);
    await expect.poll(() => storedListWidth(page)).toBe(356);
  });

  test('4. the arrow keys step it 16px, and a double-click resets it', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, 1920);
    const grip = page.getByRole('separator', {
      name: 'Resize the saved sessions list',
    });
    await grip.focus();
    await page.keyboard.press('ArrowRight');
    await expectList(page, 496);
    await expect.poll(() => storedListWidth(page)).toBe(496);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expectList(page, 464);

    await grip.dblclick();
    await expectList(page, 480);
    await expect.poll(() => storedListWidth(page)).toBeNull();
  });

  test('5. side by side at 1280 there is no list grip; folded there is, up to 600', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, 1600);
    // CONTROL: the selector finds the grip where there is one.
    await expect(page.locator(LIST_GRIP)).toHaveCount(1);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator(DETAIL)).toBeVisible();
    await expect(page.locator(LIST_GRIP)).toHaveCount(0);
    await expectList(page, 356);

    await page
      .getByRole('button', { name: 'Fold the saved session away' })
      .click();
    await expect(page.locator(LIST_GRIP)).toHaveCount(1);
    await dragGrip(page, 400);
    await expectList(page, 600);
    expect(await widthOf(page, OPEN_NOW)).toBe(1280 - 600);
  });

  test('6. a press on the list grip never starts a row drag', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, 1920);
    await page.evaluate(() => {
      window.__sawDragging = false;
      new MutationObserver(() => {
        if (document.documentElement.hasAttribute('data-dragging'))
          window.__sawDragging = true;
      }).observe(document.documentElement, { attributes: true });
    });
    await dragGrip(page, 60);
    await expectList(page, 540);
    expect(await page.evaluate(() => window.__sawDragging)).toBe(false);
  });
});

declare global {
  interface Window {
    __sawDragging?: boolean;
  }
}
