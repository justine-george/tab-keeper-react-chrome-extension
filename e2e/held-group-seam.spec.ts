import type { Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';

// KAN-186. The seam between a group's colour strip and its title row, while
// that group is the row being dragged.
//
// The strip keeps 9px of horizontal footprint however wide it is drawn: 3px of
// colour plus 6px of margin it grows into when the band is a drop target
// (KAN-164). That margin belongs to the BAND, and the band was transparent --
// so those 6px showed whatever was behind them. At rest that is the page and
// nobody can tell. Held, the row floats over the other rows, and the reported
// symptom was seeing a tab's favicon through the gap.
//
// Measured, resting and dragging alike: strip 435.5..438.5, the row's own fill
// starting at 444.5.
//
// Driven in OPEN NOW (KAN-354). This ran on a saved session's group until a
// saved list's held row was hidden and drawn by the card at the pointer: the
// fill is still painted there, inside a row at opacity 0, so it tested
// nothing anyone sees. Open now keeps its lifted, visible row (KAN-354 C2 A)
// and the same rule (OpenNowWindow.tsx, `[data-drag-held] &`), so the claim
// is held where it can still be seen.

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

interface Staged {
  windowId: number;
  beta: number;
  gamma: number;
}

// A window of six tabs, unfocused so the tab view stays in front: a0 a1,
// the group Beta (two tabs), the group Gamma (one), a2.
async function stage(worker: Worker): Promise<Staged> {
  const staged = await worker.evaluate(async (urls: string[]) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    const ids = (win?.tabs ?? []).flatMap((t) =>
      t.id === undefined ? [] : [t.id]
    );
    if (win?.id === undefined || ids.length !== urls.length) return null;
    const windowId = win.id;
    const group = async (
      tabIds: [number, ...number[]],
      title: string,
      color: `${chrome.tabGroups.Color}`
    ) => {
      const id = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(id, { title, color });
      return id;
    };
    const [, , be0, be1, ga0] = ids;
    if (be0 === undefined || be1 === undefined || ga0 === undefined)
      return null;
    return {
      windowId,
      beta: await group([be0, be1], 'Beta', 'red'),
      gamma: await group([ga0], 'Gamma', 'blue'),
    };
  }, ['a0', 'a1', 'be0', 'be1', 'ga0', 'a2'].map(dataUrl));
  if (staged === null) throw new Error('Chrome gave no window, tab or group');
  return staged;
}

async function open(
  page: Page,
  extensionId: string,
  staged: Staged
): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  // goto resolves before React mounts (KAN-105).
  await expect(bandOf(page, staged, staged.beta)).toBeVisible();
  await expect(bandOf(page, staged, staged.gamma)).toBeVisible();
}

const bandOf = (page: Page, staged: Staged, groupId: number) =>
  page.locator(
    `[data-open-window-id="${staged.windowId}"] [data-band-id="${groupId}"]`
  );

const bandFill = (page: Page, staged: Staged, groupId: number) =>
  bandOf(page, staged, groupId).evaluate(
    (el) => getComputedStyle(el).backgroundColor
  );

// The gap the fill has to cover: between the strip's right edge and the left
// edge of the title row.
const seamWidth = (page: Page, staged: Staged, groupId: number) =>
  bandOf(page, staged, groupId).evaluate((band) => {
    const strip = band.querySelector('[data-group-color-strip]');
    const row = band.querySelector('[data-group-drag-handle]');
    if (strip === null || row === null) return -1;
    return +(
      row.getBoundingClientRect().left - strip.getBoundingClientRect().right
    ).toFixed(1);
  });

async function grabGroup(page: Page, staged: Staged, groupId: number) {
  const b = await bandOf(page, staged, groupId)
    .locator('[data-group-drag-handle]')
    .boundingBox();
  if (b === null) throw new Error('the group has no title row');
  const x = b.x + 40;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 8, { steps: 2 });
  await page.mouse.move(x, y - 60, { steps: 8 });
  await page.waitForTimeout(280);
  // PREMISE: this group is held, and drawn -- Open now shows no card.
  const held = page.locator('[data-drag-held]');
  await expect(held).toHaveAttribute('data-drag-row-id', `group:${groupId}`);
  await expect(held).not.toHaveAttribute('data-held-as-card');
  return x;
}

test.describe('the band behind a held group', () => {
  test('is filled, so nothing shows through beside the strip', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const staged = await stage(serviceWorker);
    const page = await context.newPage();
    await open(page, extensionId, staged);

    // PREMISE: there is a seam to cover, and it is the strip's reserved margin.
    expect(await seamWidth(page, staged, staged.beta)).toBeGreaterThan(0);
    // At rest the band is transparent, which is what made this invisible until
    // the row was lifted over something.
    expect(await bandFill(page, staged, staged.beta)).toBe(TRANSPARENT);

    await grabGroup(page, staged, staged.beta);

    expect(await bandFill(page, staged, staged.beta)).not.toBe(TRANSPARENT);

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // CONTROL: only the band being dragged. A rule that filled every band would
  // paint the whole pane on every drag, and would pass the test above.
  test('CONTROL: another group in the same window stays transparent', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const staged = await stage(serviceWorker);
    const page = await context.newPage();
    await open(page, extensionId, staged);

    await grabGroup(page, staged, staged.beta);

    expect(await bandFill(page, staged, staged.gamma)).toBe(TRANSPARENT);

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // CONTROL: and it lets go. The fill is tied to the held attribute, not to
  // anything the drag leaves behind.
  test('CONTROL: the fill goes when the drag ends', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const staged = await stage(serviceWorker);
    const page = await context.newPage();
    await open(page, extensionId, staged);

    await grabGroup(page, staged, staged.beta);
    expect(await bandFill(page, staged, staged.beta)).not.toBe(TRANSPARENT);

    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(280);

    expect(await bandFill(page, staged, staged.beta)).toBe(TRANSPARENT);
  });
});
