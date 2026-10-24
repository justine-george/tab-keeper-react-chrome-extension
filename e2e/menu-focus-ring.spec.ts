import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { documentLanded } from './fixtures/landed';
import { sessionHeaderMenu } from './fixtures/menus';
import { contrast, rgbToHex } from './fixtures/pixels';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { POPUP, THEMES, savedWindow, session } from './fixtures/savedWindows';
import type { ThemeColors } from '../src/hooks/useThemeColors';

// KAN-726. Every item in the ⋮ and right-click menus draws the app's inset
// ring on keyboard focus, not Chrome's blue (2.35:1 in Blue), at ≥ 3:1 on
// what is behind it. Read from computed styles per item: a screenshot can't
// tell Chrome's ring on the first item from an active state.

const SAVED_TAB = '[data-pane="detail"] [data-drag-row-id="w1-t0"]';
// Every danger item in these menus is keyed `delete` (KAN-725).
const DANGER_KEY = 'delete';

interface Reading {
  key: string;
  keyNav: boolean;
  ring: { style: string; width: string; offset: string; color: string };
  fill: string;
}

// The focused item's outline and the first opaque fill at or behind it,
// once every transition has landed.
async function readFocused(page: Page): Promise<Reading> {
  await documentLanded(page);
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !el.hasAttribute('data-menu-item'))
      throw new Error(`focus is on ${el?.outerHTML.slice(0, 80)}, not an item`);
    let fill: string | null = null;
    for (let n: Element | null = el; n !== null; n = n.parentElement) {
      const b = getComputedStyle(n).backgroundColor;
      const alpha = Number((b.match(/[\d.]+/g) ?? [])[3] ?? 1);
      if (alpha === 1) {
        fill = b;
        break;
      }
      if (alpha > 0) throw new Error(`translucent fill ${b}`);
    }
    if (fill === null) throw new Error('no opaque fill behind the item');
    const s = getComputedStyle(el);
    return {
      key: el.getAttribute('data-menu-item') ?? '',
      keyNav: document.documentElement.hasAttribute('data-key-nav'),
      ring: {
        style: s.outlineStyle,
        width: s.outlineWidth,
        offset: s.outlineOffset,
        color: s.outlineColor,
      },
      fill,
    };
  });
}

function expectRing(
  label: string,
  r: Reading,
  hovered: boolean,
  C: ThemeColors
): void {
  const danger = r.key === DANGER_KEY;
  // A danger item's ring is its ink: red at rest, white on its red fill.
  const want = danger
    ? hovered
      ? C.ON_DANGER_FILL
      : C.DANGER_INK
    : C.TEXT_COLOR;
  const color = rgbToHex(r.ring.color);
  const fill = rgbToHex(r.fill);
  expect(r.keyNav, `${label}: key-nav is on`).toBe(true);
  expect(
    { style: r.ring.style, width: r.ring.width, offset: r.ring.offset },
    `${label}: the app's inset ring`
  ).toEqual({ style: 'solid', width: '2px', offset: '-4px' });
  expect(color, `${label}: ring colour`).toBe(want.toUpperCase());
  expect(
    contrast(color, fill),
    `${label}: ring ${color} on ${fill}`
  ).toBeGreaterThanOrEqual(3);
}

// Walks the open menu by keyboard, reading each item with the pointer away,
// then resting on it. Returns the keys visited.
async function walkMenu(
  page: Page,
  menu: Locator,
  name: string,
  C: ThemeColors
): Promise<string[]> {
  const items = menu.locator('[data-menu-item]');
  const count = await items.count();
  const box = await menu.boundingBox();
  if (box === null) throw new Error(`${name}: no menu box`);
  const away: [number, number] = [box.x - 40, box.y + 10];
  const keys: string[] = [];
  // Opening focuses the first item; ArrowUp then ArrowDown makes the walk a keyboard one.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  for (let i = 0; i < count; i++) {
    if (i > 0) await page.keyboard.press('ArrowDown');
    await page.mouse.move(...away, { steps: 2 });
    const rest = await readFocused(page);
    expectRing(`${name} "${rest.key}" focused`, rest, false, C);
    const item = menu.locator(`[data-menu-item="${rest.key}"]`);
    const b = await item.boundingBox();
    if (b === null) throw new Error(`${name} "${rest.key}": no box`);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
    const hovered = await readFocused(page);
    expect(hovered.key, `${name}: the pointer did not move focus`).toBe(
      rest.key
    );
    expectRing(`${name} "${rest.key}" focused+hovered`, hovered, true, C);
    keys.push(rest.key);
  }
  return keys;
}

for (const [theme, COLORS] of THEMES) {
  test(`menu items draw the app's ring on keyboard focus in ${theme} (KAN-726)`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    await seedSessions(context, {
      ...buildContainer([
        {
          ...session('S1', 'Reading list', [savedWindow('w1', '', 2)]),
          isSelected: true,
        },
      ]),
      selectedTabGroupId: 'S1',
    });
    const page = await context.newPage();
    await page.setViewportSize(POPUP);
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.locator(SAVED_TAB)).toBeVisible();

    // The session's ⋮.
    await sessionHeaderMenu(page).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const sessionKeys = await walkMenu(
      page,
      menu,
      `${theme} session ⋮`,
      COLORS
    );
    expect(sessionKeys).toContain(DANGER_KEY);
    expect(new Set(sessionKeys).size).toBe(sessionKeys.length);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // A saved tab's right-click menu.
    await page.locator(SAVED_TAB).click({ button: 'right' });
    const rowMenu = page.locator('[role="menu"][data-row-menu]');
    await expect(rowMenu).toBeVisible();
    const rowKeys = await walkMenu(page, rowMenu, `${theme} tab row`, COLORS);
    expect(rowKeys).toContain(DANGER_KEY);
    expect(new Set(rowKeys).size).toBe(rowKeys.length);
  });
}
