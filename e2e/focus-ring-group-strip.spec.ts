import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-405 2A on the group colour strip: Esc after a click-opened picker
// returns focus to the strip without a ring.

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

const WINDOW = {
  windowId: 'w0',
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 5,
  title: 'w0',
  tabs: [
    tab('l0'),
    tab('alpha0', 'alpha'),
    tab('alpha1', 'alpha'),
    tab('alpha2', 'alpha'),
    tab('l1'),
  ],
  chromeTabGroups: [{ groupId: 'alpha', title: 'Alpha', color: 'blue' }],
};

const STRIP = '[data-band-id="alpha"] [data-group-color-strip]';

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Strip target',
    isSelected: true,
    windowCount: 1,
    tabCount: WINDOW.tabs.length,
    windows: [WINDOW],
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator(STRIP)).toBeAttached();
  // PREMISE: the band only renders when the permission is granted.
  expect(
    await page.evaluate(() =>
      chrome.permissions.contains({ permissions: ['tabGroups'] })
    )
  ).toBe(true);
  return page;
}

const ringOf = (page: Page) =>
  page.locator(STRIP).evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      focused: el === document.activeElement,
      visible: el.matches(':focus-visible'),
      outline: s.outlineStyle,
      ring: `${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`,
    };
  });

test('click the strip, then Esc: focus on the strip, no ring; the next keys bring it back', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  await page.locator(STRIP).click();
  await expect(page.getByRole('menu')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await ringOf(page)).toMatchObject({
    focused: true,
    visible: false,
    outline: 'none',
  });

  // CONTROL, and round 2 B: a keyboard focus paints 2px of TEXT_COLOR, 2px out.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  expect(await ringOf(page)).toEqual({
    focused: true,
    visible: true,
    outline: 'solid',
    ring: '2px rgb(59, 61, 64) 2px',
  });
  const b = await page.locator(STRIP).boundingBox();
  if (b === null) throw new Error('no strip box');
  // For the eye: the ring sits outside the strip's own box.
  await page.screenshot({
    path: test.info().outputPath('strip-ring.png'),
    clip: { x: b.x - 12, y: b.y - 12, width: 200, height: b.height + 24 },
  });
});
