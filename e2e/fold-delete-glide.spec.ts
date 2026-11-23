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
import { differingPixels } from './fixtures/pixels';

// KAN-984 on the real artifact (picks fold B, delete C). A fold or a delete
// draws its layout change as motion: the rows below glide to their place,
// what left fades out where it stood (a copy no code can find), what arrived
// fades in, and a group's colour strip keeps its length while its end travels
// with the rows. Collapse all and Expand all glide the same way. From the
// keyboard and under Reduce motion it all happens at once.

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
// name ending in ":h", its height; ":clip", whether it is clipped; ":copy",
// the top of the text in a leaving copy that reads its value; ":sh", its
// scroll height), and how many leaving copies are drawn.
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
          const el = name.endsWith(':copy')
            ? ([...document.querySelectorAll('[data-leaving-row] *')].find(
                (e) => e.childElementCount === 0 && e.textContent === sel
              ) ?? null)
            : document.querySelector(sel);
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
                  : name.endsWith(':sh')
                    ? el.scrollHeight
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

test('Collapse all glides the windows up, and Expand all glides them back', async ({
  context,
  extensionId,
}) => {
  const page = await openTrip(context, extensionId);
  const next = '[data-pane="detail"] [data-drop-window-id="w2"]';
  const open = await topOf(block(page, 'w2'));
  const titleWas = await topOf(
    tabRow(page, 'w2-t1').getByText('Page w2.1', { exact: true })
  );

  await startSampling(page, {
    next,
    'title:copy': 'Page w2.1',
  });
  await page
    .getByRole('button', { name: 'Collapse all windows', exact: true })
    .click();
  const folding = await samples(page);
  const folded = await topOf(block(page, 'w2'));

  expect(open - folded).toBeGreaterThan(80);
  expect(between(folding.next, open, folded).length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...folding.copies)).toBeGreaterThan(0);
  // The copy starts where its row stood.
  const copiedAt = folding['title:copy'].find((v) => !Number.isNaN(v));
  expect(copiedAt).toBeCloseTo(titleWas, 0);
  await expect(page.locator('[data-leaving-row]')).toHaveCount(0);

  await startSampling(page, { next });
  await page
    .getByRole('button', { name: 'Expand all windows', exact: true })
    .click();
  const unfolding = await samples(page);
  await expect.poll(() => topOf(block(page, 'w2'))).toBeCloseTo(open, 0);
  expect(between(unfolding.next, folded, open).length).toBeGreaterThanOrEqual(
    3
  );
});

test('Collapse all copies only the windows in view', async ({
  context,
  extensionId,
}) => {
  const big = session(
    'B',
    'Big',
    Array.from({ length: 12 }, (_, i) => savedWindow(`b${i}`, `W${i}`, 30))
  );
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [big],
    selected: 'B',
  });
  await expect(tabRow(page, 'b0-t0')).toBeVisible();
  await documentLanded(page);
  // PREMISE: the last window starts well below the window's bottom edge.
  expect(await topOf(block(page, 'b11'))).toBeGreaterThan(
    page.viewportSize()?.height ?? Infinity
  );

  await startSampling(page, {});
  await page
    .getByRole('button', { name: 'Collapse all windows', exact: true })
    .click();
  const s = await samples(page);

  expect(Math.max(...s.copies)).toBeGreaterThan(0);
  expect(Math.max(...s.copies)).toBeLessThan(12);
  await expect(page.locator('[data-leaving-row]')).toHaveCount(0);
});

test('Collapse all from the keyboard is instant', async ({
  context,
  extensionId,
}) => {
  const page = await openTrip(context, extensionId);
  const from = await topOf(block(page, 'w2'));

  await startSampling(page, {
    next: '[data-pane="detail"] [data-drop-window-id="w2"]',
  });
  await page
    .getByRole('button', { name: 'Collapse all windows', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  const s = await samples(page);
  const to = await topOf(block(page, 'w2'));

  expect(from - to).toBeGreaterThan(80);
  expect(between(s.next, from, to)).toEqual([]);
  expect(Math.max(...s.copies)).toBe(0);
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

test('Collapse all in Currently open glides the windows below up', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const k = await openKyoto(serviceWorker);
  const win = page.locator(`[data-open-window-id="${k.windowId}"]`);
  await expect(win.locator('[data-open-tab-id]')).toHaveCount(3);
  await elementLanded(win, 'ancestors');
  const from = await topOf(win);
  const ids = await page
    .locator('[data-open-window-id]')
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-open-window-id'))
    );
  // Only a window below another one moves when the ones above it fold.
  expect(ids.indexOf(String(k.windowId))).toBeGreaterThan(0);

  await startSampling(
    page,
    { next: `[data-open-window-id="${k.windowId}"]` },
    1200
  );
  await page
    .getByRole('button', { name: 'Collapse all windows', exact: true })
    .click();
  const s = await samples(page);
  await expect(win.locator('[data-open-tab-id]')).toHaveCount(0);
  const to = await topOf(win);

  expect(from - to).toBeGreaterThan(20);
  expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
});

test.describe('the scroll range while a fold glides (KAN-985)', () => {
  const LONG = session(
    'L',
    'Long',
    Array.from({ length: 8 }, (_, i) => savedWindow(`l${i}`, `W${i}`, 6))
  );

  async function openLong(
    context: Parameters<typeof openSaved>[0],
    extensionId: string
  ) {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [LONG],
      selected: 'L',
    });
    await expect(header(page, 'l7')).toBeVisible();
    await documentLanded(page);
    // The detail pane's scroll area, named for the sampler.
    await page.evaluate(() => {
      const pane = document.querySelector('[data-pane="detail"]');
      const sc = [...(pane?.querySelectorAll('*') ?? [])].find(
        (e) => getComputedStyle(e).overflowY === 'auto'
      );
      sc?.setAttribute('data-test-scroller', '');
    });
    const scroller = page.locator('[data-test-scroller]');
    // PREMISE: the list scrolls.
    expect(
      await scroller.evaluate((e) => e.scrollHeight - e.clientHeight)
    ).toBeGreaterThan(400);
    await scroller.evaluate((e) => (e.scrollTop = e.scrollHeight));
    return { page, scroller };
  }

  test('folding a window at the bottom: the range is the landed one from the first frame', async ({
    context,
    extensionId,
  }) => {
    const { page, scroller } = await openLong(context, extensionId);

    await startSampling(page, { 'range:sh': '[data-test-scroller]' });
    await header(page, 'l6')
      .getByRole('button', { name: /^Collapse/ })
      .first()
      .click();
    const s = await samples(page);
    const landed = await scroller.evaluate((e) => e.scrollHeight);

    // PREMISE: it glided, and the range shrank.
    expect(Math.max(...s.copies)).toBeGreaterThan(0);
    expect(s['range:sh'][0]).toBeGreaterThan(landed + 100);
    // Straight from the old range to the landed one: no frame in between.
    expect(between(s['range:sh'], landed, s['range:sh'][0])).toEqual([]);
    expect(s['range:sh'][s['range:sh'].length - 1]).toBe(landed);
  });

  test('Collapse all from the bottom: no scroll bar comes and goes', async ({
    context,
    extensionId,
  }) => {
    const { page, scroller } = await openLong(context, extensionId);
    const client = await scroller.evaluate((e) => e.clientHeight);

    await startSampling(page, { 'range:sh': '[data-test-scroller]' });
    await page
      .getByRole('button', { name: 'Collapse all windows', exact: true })
      .click();
    const s = await samples(page);

    expect(Math.max(...s.copies)).toBeGreaterThan(0);
    const after = s['range:sh'].slice(
      s['range:sh'].findIndex((v) => v <= client)
    );
    expect(after.length).toBeGreaterThan(5);
    expect(Math.max(...after)).toBe(client);
  });

  test('holding the range cuts nothing on screen', async ({
    context,
    extensionId,
  }) => {
    const { page, scroller } = await openLong(context, extensionId);
    await page
      .getByRole('button', { name: 'Collapse all windows', exact: true })
      .click();
    // Mid-glide, with copies fading below the list's new end.
    await expect(page.locator('[data-leaving-row]').first()).toBeAttached();
    await page.evaluate(() =>
      document.getAnimations().forEach((a) => {
        a.pause();
        a.currentTime = 60;
      })
    );
    const content = scroller.locator('> *');
    expect(await content.evaluate((e) => getComputedStyle(e).overflow)).toBe(
      'clip'
    );
    const held = await scroller.screenshot({ animations: 'allow' });
    await content.evaluate((e) => {
      e.style.overflow = '';
      e.style.overflowClipMargin = '';
    });
    const free = await scroller.screenshot({ animations: 'allow' });
    // The panel's rounded border is antialiased a little differently with and
    // without the clip on CI's renderer: only what is inside it must match.
    const ring = await scroller.evaluate((e) =>
      Math.ceil(
        parseFloat(getComputedStyle(e).borderBottomRightRadius) *
          devicePixelRatio
      )
    );
    expect(ring).toBeGreaterThan(0);
    // A PNG's width and height sit at bytes 16 and 20 of its header.
    const [w, h] = [held.readUInt32BE(16), held.readUInt32BE(20)];
    const apart = (await differingPixels(page, held, free)).filter(
      ([x, y]) => x >= ring && x < w - ring && y >= ring && y < h - ring
    ).length;
    if (apart > 0) {
      await test
        .info()
        .attach('held', { body: held, contentType: 'image/png' });
      await test
        .info()
        .attach('free', { body: free, contentType: 'image/png' });
    }
    expect(apart).toBe(0);
  });
});
