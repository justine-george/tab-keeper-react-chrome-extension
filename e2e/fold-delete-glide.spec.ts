import type { Locator, Page, Worker } from '@playwright/test';

// Saved groups draw as bands only with tabGroups, so every spec here needs the grant.
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  bandHandle,
  groupedWindow,
  header,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';
import { elementLanded, documentLanded } from './fixtures/landed';
import { standIn } from './fixtures/standInPages';

// KAN-984 on the real artifact (picks fold B, delete C). A fold or a delete
// draws its layout change as motion: the rows below glide to their place,
// what left fades out where it stood (a copy no code can find), what arrived
// fades in, and a group's colour strip keeps its length while its end travels
// with the rows. From the keyboard, under Reduce motion, and for Collapse all,
// it all happens at once.

const TRIP = session('S1', 'Trip', [
  groupedWindow('gw', 'Flights & stays', [
    { groupId: 'g1', title: 'Booked', color: 'green' },
    { groupId: 'g2', title: 'Explore', color: 'pink' },
  ]),
  savedWindow('w2', 'Food', 3),
]);
const OTHERS = ['S2', 'S3', 'S4', 'S5'].map((id) =>
  session(id, `Session ${id}`, [savedWindow(`${id}-w`, 'Window', 2)])
);

const band = (page: Page, id: string): Locator =>
  page.locator(`[data-pane="detail"] [data-band-id="${id}"][role="group"]`);
const block = (page: Page, id: string): Locator =>
  page.locator(`[data-pane="detail"] [data-drop-window-id="${id}"]`);
const tabRow = (page: Page, id: string): Locator =>
  page.locator(`[data-pane="detail"] [data-drag-row-id="${id}"]`);
const sessionRow = (page: Page, id: string): Locator =>
  page.locator(`[data-pane="sessions"] [data-drag-row-id="${id}"]`);
const fold = (page: Page, groupId: string, title: string) =>
  bandHandle(page, groupId).getByRole('button', {
    name: `Collapse: ${title}`,
    exact: true,
  });
const unfold = (page: Page, groupId: string, title: string) =>
  bandHandle(page, groupId).getByRole('button', {
    name: `Expand: ${title}`,
    exact: true,
  });
const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');

interface Samples {
  [name: string]: number[];
}

// Each animation frame for `ms`, from now: every named element's top (for a
// name ending in ":h", its height; ":clip", whether it is clipped), and how
// many leaving copies are drawn.
async function startSampling(
  page: Page,
  targets: Record<string, string>,
  ms = 700
): Promise<void> {
  await page.evaluate(
    ({ targets, ms }) => {
      const out: Record<string, number[]> = { copies: [] };
      Object.keys(targets).forEach((k) => (out[k] = []));
      (window as unknown as { __samples: typeof out }).__samples = out;
      const end = performance.now() + ms;
      const tick = () => {
        for (const [name, sel] of Object.entries(targets)) {
          const el = document.querySelector(sel);
          const r = el?.getBoundingClientRect();
          // ":clip": 1 while the element is clipped, else 0.
          out[name].push(
            el === null || r === undefined
              ? NaN
              : name.endsWith(':clip')
                ? getComputedStyle(el).clipPath === 'none'
                  ? 0
                  : 1
                : name.endsWith(':h')
                  ? r.height
                  : r.top
          );
        }
        out.copies.push(document.querySelectorAll('[data-leaving-row]').length);
        if (performance.now() < end) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { targets, ms }
  );
}

async function samples(page: Page): Promise<Samples> {
  await page.waitForFunction(() => {
    const s = (window as unknown as { __samples?: Samples }).__samples;
    return s !== undefined && s.copies.length > 20;
  });
  await page.waitForTimeout(750);
  return page.evaluate(
    () => (window as unknown as { __samples: Samples }).__samples
  );
}

// The frames drawn strictly between two places: a glide passes through them, a jump has none.
const between = (values: number[], from: number, to: number): number[] =>
  values.filter(
    (v) => v > Math.min(from, to) + 2 && v < Math.max(from, to) - 2
  );

async function topOf(loc: Locator): Promise<number> {
  return (await loc.boundingBox())?.y ?? NaN;
}

async function openTrip(
  context: Parameters<typeof openSaved>[0],
  extensionId: string
) {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [TRIP, ...OTHERS],
  });
  await expect(band(page, 'g2')).toBeVisible();
  await documentLanded(page);
  return page;
}

test.describe('folding a saved group', () => {
  test('the rows below glide up, its rows fade out as a copy, and its strip shortens with them', async ({
    context,
    extensionId,
  }) => {
    const page = await openTrip(context, extensionId);
    const from = await topOf(band(page, 'g2'));
    const stripFrom =
      (await band(page, 'g1').locator('[data-group-color-strip]').boundingBox())
        ?.height ?? NaN;

    await startSampling(page, {
      next: '[data-pane="detail"] [data-band-id="g2"][role="group"]',
      'strip:h':
        '[data-pane="detail"] [data-band-id="g1"] [data-group-color-strip]',
    });
    await fold(page, 'g1', 'Booked').click();
    const s = await samples(page);

    const to = await topOf(band(page, 'g2'));
    const stripTo =
      (await band(page, 'g1').locator('[data-group-color-strip]').boundingBox())
        ?.height ?? NaN;
    // PREMISE: the fold moved the band below up.
    expect(from - to).toBeGreaterThan(40);
    expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
    expect(s.next[s.next.length - 1]).toBeCloseTo(to, 0);
    // The strip passes through lengths between its two.
    expect(
      between(s['strip:h'], stripFrom, stripTo).length
    ).toBeGreaterThanOrEqual(3);
    // The folded rows fade out as a copy, then the copy is gone.
    expect(Math.max(...s.copies)).toBeGreaterThan(0);
    expect(s.copies[s.copies.length - 1]).toBe(0);
    await expect(page.locator('[data-leaving-row]')).toHaveCount(0);
  });

  test('unfolding it: the rows below glide down and its rows fade in', async ({
    context,
    extensionId,
  }) => {
    const page = await openTrip(context, extensionId);
    await fold(page, 'g1', 'Booked').click();
    await documentLanded(page);
    await page.mouse.move(2, 2);
    const from = await topOf(band(page, 'g2'));

    await startSampling(page, {
      next: '[data-pane="detail"] [data-band-id="g2"][role="group"]',
      'returning:clip': '[data-pane="detail"] [data-drag-row-id="g1-t1"]',
    });
    await unfold(page, 'g1', 'Booked').click();
    const s = await samples(page);
    const to = await topOf(band(page, 'g2'));

    expect(to - from).toBeGreaterThan(40);
    expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
    // Never clipped: Chrome can draw a clip animation's first frame again as it ends (a one-frame flash).
    expect(s['returning:clip'].filter((v) => v === 1)).toEqual([]);
    // A returning row starts clear and ends opaque.
    const opacity = await tabRow(page, 'g1-t0').evaluate(
      (el) => getComputedStyle(el).opacity
    );
    expect(opacity).toBe('1');
  });

  test('from the keyboard the fold is instant', async ({
    context,
    extensionId,
  }) => {
    const page = await openTrip(context, extensionId);
    const from = await topOf(band(page, 'g2'));
    await fold(page, 'g1', 'Booked').focus();

    await startSampling(page, {
      next: '[data-pane="detail"] [data-band-id="g2"][role="group"]',
    });
    await page.keyboard.press('Enter');
    const s = await samples(page);
    const to = await topOf(band(page, 'g2'));

    // PREMISE: Enter folded it.
    expect(from - to).toBeGreaterThan(40);
    expect(between(s.next, from, to)).toEqual([]);
    expect(Math.max(...s.copies)).toBe(0);
  });

  test('with Reduce motion the fold is instant', async ({
    context,
    extensionId,
  }) => {
    const page = await openTrip(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const from = await topOf(band(page, 'g2'));

    await startSampling(page, {
      next: '[data-pane="detail"] [data-band-id="g2"][role="group"]',
    });
    await fold(page, 'g1', 'Booked').click();
    const s = await samples(page);
    const to = await topOf(band(page, 'g2'));

    expect(from - to).toBeGreaterThan(40);
    expect(between(s.next, from, to)).toEqual([]);
    expect(Math.max(...s.copies)).toBe(0);
  });
});

test('folding a saved window glides the window below up', async ({
  context,
  extensionId,
}) => {
  const page = await openTrip(context, extensionId);
  const from = await topOf(block(page, 'w2'));

  await startSampling(page, {
    next: '[data-pane="detail"] [data-drop-window-id="w2"]',
  });
  await header(page, 'gw')
    .getByRole('button', { name: /^Collapse/ })
    .first()
    .click();
  const s = await samples(page);
  const to = await topOf(block(page, 'w2'));

  expect(from - to).toBeGreaterThan(80);
  expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...s.copies)).toBeGreaterThan(0);
  await expect(page.locator('[data-leaving-row]')).toHaveCount(0);
});

test('Collapse all stays instant', async ({ context, extensionId }) => {
  const page = await openTrip(context, extensionId);
  const from = await topOf(block(page, 'w2'));

  await startSampling(page, {
    next: '[data-pane="detail"] [data-drop-window-id="w2"]',
  });
  await page
    .getByRole('button', { name: 'Collapse all windows', exact: true })
    .click();
  const s = await samples(page);
  const to = await topOf(block(page, 'w2'));

  expect(from - to).toBeGreaterThan(80);
  expect(between(s.next, from, to)).toEqual([]);
});

test.describe('deleting a tab', () => {
  test('the rows below close up as the toast arrives, and Undo opens the gap again', async ({
    context,
    extensionId,
  }) => {
    const page = await openTrip(context, extensionId);
    const below = tabRow(page, 'g1-t1');
    const from = await topOf(below);

    await startSampling(page, {
      next: '[data-pane="detail"] [data-drag-row-id="g1-t1"]',
    });
    await tabRow(page, 'g1-t0').hover();
    await tabRow(page, 'g1-t0')
      .getByRole('button', { name: 'Delete tab' })
      .click();
    const s = await samples(page);
    const to = await topOf(below);

    await expect(toasts(page)).toContainText('Session tab deleted.');
    expect(from - to).toBeGreaterThan(20);
    expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...s.copies)).toBeGreaterThan(0);
    await expect(page.locator('[data-leaving-row]')).toHaveCount(0);

    await startSampling(page, {
      next: '[data-pane="detail"] [data-drag-row-id="g1-t1"]',
      'returning:clip': '[data-pane="detail"] [data-drag-row-id="g1-t0"]',
    });
    await page
      .getByRole('status')
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    const back = await samples(page);
    await expect(tabRow(page, 'g1-t0')).toBeVisible();
    expect(await topOf(below)).toBeCloseTo(from, 0);
    expect(between(back.next, to, from).length).toBeGreaterThanOrEqual(3);
    expect(back['returning:clip'].filter((v) => v === 1)).toEqual([]);
  });

  test('with Reduce motion it is instant', async ({ context, extensionId }) => {
    const page = await openTrip(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const below = tabRow(page, 'g1-t1');
    const from = await topOf(below);

    await startSampling(page, {
      next: '[data-pane="detail"] [data-drag-row-id="g1-t1"]',
    });
    await tabRow(page, 'g1-t0').hover();
    await tabRow(page, 'g1-t0')
      .getByRole('button', { name: 'Delete tab' })
      .click();
    const s = await samples(page);
    const to = await topOf(below);

    expect(from - to).toBeGreaterThan(20);
    expect(between(s.next, from, to)).toEqual([]);
    expect(Math.max(...s.copies)).toBe(0);
  });
});

test.describe('deleting a session', () => {
  test('from its menu: the sessions below close up', async ({
    context,
    extensionId,
  }) => {
    const page = await openTrip(context, extensionId);
    const below = sessionRow(page, 'S4');
    const from = await topOf(below);

    await startSampling(page, {
      next: '[data-pane="sessions"] [data-drag-row-id="S4"]',
    });
    await sessionRow(page, 'S3').click({
      button: 'right',
      position: { x: 40, y: 20 },
    });
    await page.getByRole('menuitem', { name: 'Delete session' }).click();
    const s = await samples(page);
    const to = await topOf(below);

    await expect(toasts(page)).toContainText('Session deleted.');
    expect(from - to).toBeGreaterThan(30);
    expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...s.copies)).toBeGreaterThan(0);
    await expect(page.locator('[data-leaving-row]')).toHaveCount(0);
  });

  test('with the Delete key it is instant', async ({
    context,
    extensionId,
  }) => {
    const page = await openTrip(context, extensionId);
    const below = sessionRow(page, 'S4');
    const from = await topOf(below);
    await sessionRow(page, 'S3')
      .getByRole('button', { name: 'Session S3', exact: true })
      .focus();

    await startSampling(page, {
      next: '[data-pane="sessions"] [data-drag-row-id="S4"]',
    });
    await page.keyboard.press('Delete');
    const s = await samples(page);
    const to = await topOf(below);

    expect(from - to).toBeGreaterThan(30);
    expect(between(s.next, from, to)).toEqual([]);
    expect(Math.max(...s.copies)).toBe(0);
  });
});

// Currently open: the fold is Chrome's own collapse, answered a moment later.
async function openKyoto(worker: Worker) {
  return worker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ url: urls, focused: false });
    const [temples, gardens, loose] = (win?.tabs ?? []).map((t) => t.id ?? -1);
    const groupId = await chrome.tabs.group({
      tabIds: [temples, gardens],
      createProperties: { windowId: win?.id },
    });
    await chrome.tabGroups.update(groupId, { title: 'Kyoto', color: 'blue' });
    return { windowId: win?.id ?? -1, groupId, loose };
  }, ['Temples', 'Gardens', 'Loose'].map(standIn));
}

test('folding a live group in Currently open glides the rows below', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const k = await openKyoto(serviceWorker);
  const win = page.locator(`[data-open-window-id="${k.windowId}"]`);
  const loose = win.locator(`[data-open-tab-id="${k.loose}"]`);
  await expect(win.locator('[data-open-tab-id]')).toHaveCount(3);
  await elementLanded(loose, 'ancestors');
  const from = await topOf(loose);

  await startSampling(
    page,
    {
      next: `[data-open-window-id="${k.windowId}"] [data-open-tab-id="${k.loose}"]`,
    },
    1200
  );
  await win
    .locator(`[data-band-id="${k.groupId}"] [data-group-drag-handle]`)
    .getByRole('button', { name: 'Collapse: Kyoto', exact: true })
    .click();
  const s = await samples(page);
  await expect(win.locator('[data-open-tab-id]')).toHaveCount(1);
  const to = await topOf(loose);

  expect(from - to).toBeGreaterThan(40);
  expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
});
