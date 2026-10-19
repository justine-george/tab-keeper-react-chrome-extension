import type { Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  bandHandle,
  boxOf,
  groupedWindow,
  header,
  openSaved,
  savedWindow,
  session,
  stored,
} from './fixtures/savedWindows';
import { standIn } from './fixtures/standInPages';

// KAN-701. Six dots on the row under the pointer, where its drag can start:
// in the column left of a tab or group row, in a session row's gutter, and
// over a window's own glyph, which they replace. None at rest, none on
// keyboard focus, none where the drag is off; the held row keeps its own
// until the release.

const WORK = groupedWindow('w1', 'Work', [
  { groupId: 'gr', title: 'Kyoto', color: 'blue' },
]);
WORK.tabs.push({
  tabId: 'w1-loose',
  favicon: '',
  title: 'Loose page',
  url: 'https://loose.test/',
});
WORK.tabCount = WORK.tabs.length;
const SESSIONS = [
  session('S1', 'Launch week', [WORK, savedWindow('w2', 'Other', 1)]),
  session('S2', 'Reading', [savedWindow('w3', '', 1)]),
  session('S3', 'Research', [savedWindow('w4', '', 1)]),
];

const OPEN_NOW = '[data-pane="open-now"]';
const handleIn = (row: Locator) => row.locator('[data-drag-handle]');
const savedTab = (page: Page, tabId: string) =>
  page.locator(
    `[data-pane="detail"] [data-drag-row-id="${tabId}"] [data-drag-handle-row]`
  );
const sessionRow = (page: Page, id: string) =>
  page.locator(
    `[data-pane="sessions"] [data-drag-row-id="${id}"] [data-drag-handle-row]`
  );
const windowGlyph = (row: Locator) =>
  row.getByText('web_asset', { exact: true });

/** The opacity that reaches the screen: the element's times its ancestors'. */
const inkOf = (loc: Locator) =>
  loc.evaluate((el) => {
    let ink = 1;
    for (let e: Element | null = el; e; e = e.parentElement)
      ink *= Number(getComputedStyle(e).opacity);
    return ink;
  });

/** How many handles are drawn at all, faded ones included. */
const shownHandles = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('[data-drag-handle]')].filter((el) => {
        for (let e: Element | null = el; e; e = e.parentElement)
          if (getComputedStyle(e).opacity === '0') return false;
        return true;
      }).length
  );

async function park(page: Page) {
  await page.mouse.move(2, 2);
  await expect.poll(() => shownHandles(page)).toBe(0);
}

// A window with a group of two and a loose tab, unfocused.
async function openKyoto(worker: Worker) {
  return worker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ url: urls, focused: false });
    const [first, second] = (win?.tabs ?? []).map((tab) => tab.id ?? -1);
    await chrome.tabs.group({
      tabIds: [first, second],
      createProperties: { windowId: win?.id },
    });
    const [group] = await chrome.tabGroups.query({ windowId: win?.id });
    await chrome.tabGroups.update(group.id, {
      title: 'Temples',
      color: 'blue',
    });
    return win?.id ?? -1;
  }, ['Kiyomizu', 'Ginkaku', 'Station'].map(standIn));
}

async function openBoth(
  context: Parameters<typeof openSaved>[0],
  extensionId: string,
  worker: Worker
) {
  const page = await openSaved(context, extensionId, 'tab view', {
    sessions: SESSIONS,
  });
  const block = page.locator(
    `${OPEN_NOW} [data-open-window-id="${await openKyoto(worker)}"]`
  );
  await expect(block.locator('[data-group-drag-handle]')).toBeVisible();
  await expect(block.getByText('Station')).toBeVisible();
  await park(page);
  return { page, block };
}

/** Hovers `row` and expects its handle, and only its, shown at `x` from the row's left. */
async function expectHandleAt(
  page: Page,
  row: Locator,
  x: number,
  hoverAt?: { x: number; y: number }
) {
  await row.hover(hoverAt ? { position: hoverAt } : undefined);
  const handle = handleIn(row);
  await expect.poll(() => inkOf(handle)).toBe(1);
  await expect.poll(() => shownHandles(page)).toBe(1);
  const r = await boxOf(row);
  const h = await boxOf(handle);
  expect(Math.abs(h.x - (r.x + x))).toBeLessThanOrEqual(1);
  expect(h.width).toBe(20);
  expect(Math.abs(h.y + h.height / 2 - (r.y + r.height / 2))).toBeLessThan(1);
  await park(page);
}

test('at rest no row shows a handle', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page } = await openBoth(context, extensionId, serviceWorker);
  // PREMISE: every kind of row drew one, faded out.
  expect(await page.locator('[data-drag-handle]').count()).toBeGreaterThan(8);
  expect(await shownHandles(page)).toBe(0);
});

// The dots are generated content: a ligature name in the DOM is the row's
// text too, which find in page matches and specs read (KAN-364's tabRowOf).
test("a handle adds nothing to its row's text, and draws one glyph", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page } = await openBoth(context, extensionId, serviceWorker);
  const texts = await page.evaluate(() =>
    [...document.querySelectorAll('[data-drag-handle-row]')].map(
      (row) => row.textContent ?? ''
    )
  );
  expect(texts.length).toBeGreaterThan(8);
  expect(texts.filter((t) => t.includes('drag_indicator'))).toEqual([]);

  const widest = () =>
    page.evaluate(() =>
      Math.max(
        ...[...document.querySelectorAll('[data-drag-handle] > span')].map(
          (dots) => dots.getBoundingClientRect().width
        )
      )
    );
  expect(await widest()).toBeLessThanOrEqual(20);
  // CONTROL: a name the font has no ligature for lays out as a word.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent =
      "[data-drag-handle] > span::before { content: 'drag-indicator' !important; }";
    document.head.append(style);
  });
  expect(await widest()).toBeGreaterThan(40);
});

test('a saved tab, grouped tab and group row show theirs in the column to their left', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page } = await openBoth(context, extensionId, serviceWorker);
  await expectHandleAt(page, savedTab(page, 'w1-loose'), -24);
  await expectHandleAt(page, savedTab(page, 'gr-t0'), -40);
  await expectHandleAt(page, bandHandle(page, 'gr'), -40, { x: 200, y: 16 });
});

test('a session row shows its handle in its gutter', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page } = await openBoth(context, extensionId, serviceWorker);
  await expectHandleAt(page, sessionRow(page, 'S2'), 9);
});

test('an Open now tab, grouped tab and group row show theirs', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, block } = await openBoth(context, extensionId, serviceWorker);
  const tab = (title: string) =>
    block.locator('[data-open-tab-id]', { hasText: title });
  await expectHandleAt(page, tab('Station'), -24);
  await expectHandleAt(page, tab('Kiyomizu'), -40);
  await expectHandleAt(page, block.locator('[data-group-drag-handle]'), -40, {
    x: 200,
    y: 16,
  });
});

for (const pane of ['saved', 'Open now'] as const) {
  test(`${pane === 'saved' ? 'a saved' : 'an Open now'} window row swaps its glyph for the handle`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, block } = await openBoth(context, extensionId, serviceWorker);
    const row =
      pane === 'saved'
        ? header(page, 'w1')
        : block.locator('[data-window-row]');
    await expect.poll(() => inkOf(windowGlyph(row))).toBe(1);

    const r = await boxOf(row);
    await row.hover({ position: { x: r.width / 2, y: r.height / 2 } });
    await expect.poll(() => inkOf(handleIn(row))).toBe(1);
    await expect.poll(() => inkOf(windowGlyph(row))).toBe(0);
    expect(await shownHandles(page)).toBe(1);
    // Over the glyph, same centre.
    const g = await boxOf(windowGlyph(row));
    const h = await boxOf(handleIn(row));
    expect(Math.abs(h.x + h.width / 2 - (g.x + g.width / 2))).toBeLessThan(1);
    expect(Math.abs(h.y + h.height / 2 - (g.y + g.height / 2))).toBeLessThan(1);

    await park(page);
    await expect.poll(() => inkOf(windowGlyph(row))).toBe(1);
  });
}

test('a tab row reached by the keyboard shows no handle', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page } = await openBoth(context, extensionId, serviceWorker);
  const row = savedTab(page, 'w1-loose');
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await row.evaluate((el) => el.contains(document.activeElement));
  }
  // PREMISE: a real Tab focused the row, so :focus-visible matches.
  expect(reached).toBe(true);
  expect(await row.evaluate((el) => el.matches(':has(:focus-visible)'))).toBe(
    true
  );
  await page.waitForTimeout(300);
  await expect.poll(() => inkOf(handleIn(row))).toBe(0);
});

test('under a saved search, where the saved drags are off, no saved row draws one', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page } = await openBoth(context, extensionId, serviceWorker);
  const saved = page.locator(
    '[data-pane="detail"] [data-drag-handle], [data-pane="sessions"] [data-drag-handle]'
  );
  // CONTROL: drawn before the search.
  expect(await saved.count()).toBeGreaterThan(5);

  await page.getByPlaceholder('Search saved tabs').fill('Page');
  await expect(savedTab(page, 'gr-t0')).toBeVisible();
  await savedTab(page, 'gr-t0').hover();
  await expect(saved).toHaveCount(0);
});

test("under Open now's search its window and group rows draw none; its tabs, still carried, keep theirs", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, block } = await openBoth(context, extensionId, serviceWorker);
  const windowRow = block.locator('[data-window-row]');
  const groupRow = block.locator('[data-group-drag-handle]');
  // CONTROL: both drawn before the search.
  await expect(handleIn(windowRow)).toHaveCount(1);
  await expect(handleIn(groupRow)).toHaveCount(1);

  await page
    .locator(OPEN_NOW)
    .getByRole('textbox', { name: 'Search open tabs', exact: true })
    .fill('Kiyomizu');
  await expect(groupRow).toBeVisible();
  await expect(handleIn(windowRow)).toHaveCount(0);
  await expect(handleIn(groupRow)).toHaveCount(0);
  await expect.poll(() => inkOf(windowGlyph(windowRow))).toBe(1);
  const tab = block.locator('[data-open-tab-id]', { hasText: 'Kiyomizu' });
  await tab.hover();
  await expect.poll(() => inkOf(handleIn(tab))).toBe(1);
});

test('the held row keeps its handle off the pointer, and no other row shows one', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page } = await openBoth(context, extensionId, serviceWorker);
  const row = sessionRow(page, 'S1');
  const r = await boxOf(row);
  const x = r.x + r.width / 2;
  await page.mouse.move(x, r.y + r.height / 2);
  await page.mouse.down();
  // Down a row, then out of the pane sideways: the row moves only up and down.
  await page.mouse.move(x, r.y + r.height * 1.5, { steps: 10 });
  await page.mouse.move(r.x + r.width + 40, r.y + r.height * 1.5, {
    steps: 10,
  });
  await expect(page.locator('html[data-carrying]')).toHaveCount(0);
  await expect(page.locator('html[data-dragging]')).toHaveCount(1);
  // PREMISE: the pointer has left the held row, so its :hover is gone.
  expect(await row.evaluate((el) => el.matches(':hover'))).toBe(false);
  await expect.poll(() => inkOf(handleIn(row))).toBe(1);
  expect(await shownHandles(page)).toBe(1);

  // Over a saved tab row, hovered mid-drag: it shows none.
  const other = savedTab(page, 'w1-loose');
  const o = await boxOf(other);
  await page.mouse.move(o.x + o.width / 2, o.y + o.height / 2, { steps: 10 });
  await expect(page.locator('html[data-dragging]')).toHaveCount(1);
  expect(await other.evaluate((el) => el.matches(':hover'))).toBe(true);
  await page.waitForTimeout(300);
  expect(await shownHandles(page)).toBe(1);
  await expect.poll(() => inkOf(handleIn(row))).toBe(1);

  // Released: the held row's goes, and the row now under the pointer shows its.
  await page.mouse.up();
  await expect(page.locator('html[data-dragging]')).toHaveCount(0);
  await expect.poll(() => inkOf(handleIn(row))).toBe(0);
  await expect.poll(() => inkOf(handleIn(other))).toBe(1);
  expect(await shownHandles(page)).toBe(1);
});

// Between the drag's start and the render that marks the row held, the held
// row's hover is all that shows its handle. Under reduced motion nothing
// fades, so a gap there is a blink.
test("the held row's handle does not blink at the pick-up", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page } = await openBoth(context, extensionId, serviceWorker);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const row = sessionRow(page, 'S2');
  const r = await boxOf(row);
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  for (let run = 0; run < 3; run++) {
    await page.mouse.move(x, y);
    await expect.poll(() => inkOf(handleIn(row))).toBe(1);
    await row.evaluate((el) => {
      const log: string[] = [];
      const handle = el.querySelector('[data-drag-handle]')!;
      const tick = () => {
        const dragging = document.documentElement.hasAttribute('data-dragging');
        log.push(`${dragging}:${getComputedStyle(handle).opacity}`);
        if (log.length < 30) requestAnimationFrame(tick);
        else el.setAttribute('data-probe', log.join(' '));
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.down();
    await page.mouse.move(x, y + 12, { steps: 4 });
    await expect(row).toHaveAttribute('data-probe', /./);
    const frames = (await row.getAttribute('data-probe'))!.split(' ');
    await page.mouse.up();
    await row.evaluate((el) => el.removeAttribute('data-probe'));
    // PREMISE: the drag started inside the log.
    expect(frames).toContain('true:1');
    expect(frames.filter((f) => f === 'true:0')).toEqual([]);
  }
});

test('the handle fades in as the strips do, and at once under reduced motion', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page } = await openBoth(context, extensionId, serviceWorker);
  const handle = handleIn(savedTab(page, 'w1-loose'));
  await expect(handle).toHaveCSS('transition-duration', '0.12s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(handle).toHaveCSS('transition-duration', '0s');
});

// KAN-703. Dots outside their row's box (tab and group rows) take the
// pointer for it: pointed at they stay, pressed and moved they drag the row,
// clicked they do nothing. A session row's are inside it and stay a picture.
const OUTSIDE = [
  ['saved tab', 'tab'],
  ['saved grouped tab', 'tab'],
  ['saved group', 'group'],
  ['Open now tab', 'tab'],
  ['Open now grouped tab', 'tab'],
  ['Open now group', 'group'],
] as const;
const outsideRow = (
  page: Page,
  block: Locator,
  kind: (typeof OUTSIDE)[number][0]
) => {
  const tab = (title: string) =>
    block.locator('[data-open-tab-id]', { hasText: title });
  switch (kind) {
    case 'saved tab':
      return savedTab(page, 'w1-loose');
    case 'saved grouped tab':
      return savedTab(page, 'gr-t0');
    case 'saved group':
      return bandHandle(page, 'gr');
    case 'Open now tab':
      return tab('Station');
    case 'Open now grouped tab':
      return tab('Kiyomizu');
    case 'Open now group':
      return block.locator('[data-group-drag-handle]');
  }
};
const centreOf = async (loc: Locator) => {
  const b = await boxOf(loc);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const hitIsIn = (at: { x: number; y: number }, loc: Locator) =>
  loc.evaluate(
    (el, at) => el.contains(document.elementFromPoint(at.x, at.y)),
    at
  );

test("pointed at, a tab or group row's dots stay, and are what the pointer hits", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, block } = await openBoth(context, extensionId, serviceWorker);
  for (const [kind] of OUTSIDE) {
    const row = outsideRow(page, block, kind);
    await row.hover();
    await expect.poll(() => inkOf(handleIn(row))).toBe(1);
    const at = await centreOf(handleIn(row));
    await page.mouse.move(at.x, at.y, { steps: 5 });
    await page.waitForTimeout(300);
    expect(await hitIsIn(at, handleIn(row)), kind).toBe(true);
    expect(await row.evaluate((el) => el.matches(':hover')), kind).toBe(true);
    expect(await inkOf(handleIn(row)), kind).toBe(1);
    expect(
      await page.evaluate(
        (at) => getComputedStyle(document.elementFromPoint(at.x, at.y)!).cursor,
        at
      ),
      kind
    ).toBe('grab');
    await park(page);
  }
  // CONTROL: a session row's dots sit inside it, and a press there is the row's.
  const sessionDots = handleIn(sessionRow(page, 'S2'));
  await sessionRow(page, 'S2').hover();
  const at = await centreOf(sessionDots);
  await page.mouse.move(at.x, at.y);
  expect(await hitIsIn(at, sessionDots)).toBe(false);
});

test("pressed and moved, a tab or group row's dots drag that row", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, block } = await openBoth(context, extensionId, serviceWorker);
  for (const [kind, dragKind] of OUTSIDE) {
    const row = outsideRow(page, block, kind);
    await row.hover();
    const at = await centreOf(handleIn(row));
    await page.mouse.move(at.x, at.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(at.x + 2, at.y + 14, { steps: 6 });
    await expect(
      page.locator(`html[data-dragging="${dragKind}"]`),
      kind
    ).toHaveCount(1);
    expect(
      await row.evaluate((el) => el.closest('[data-drag-held]') !== null),
      kind
    ).toBe(true);
    // Back to the start and release: nothing moves.
    await page.mouse.move(at.x, at.y, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('html[data-dragging]')).toHaveCount(0);
    await park(page);
  }
});

test("a click on a tab row's dots opens nothing and switches to nothing", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, block } = await openBoth(context, extensionId, serviceWorker);
  const pagesBefore = context.pages().length;
  const saved = savedTab(page, 'w1-loose');
  await saved.hover();
  await handleIn(saved).click();

  const live = outsideRow(page, block, 'Open now tab');
  const activeOf = () =>
    serviceWorker.evaluate(async (title) => {
      const [tab] = await chrome.tabs.query({ title });
      return tab?.active ?? null;
    }, 'Station');
  // PREMISE: the live tab is not the active one, so a switch would show.
  expect(await activeOf()).toBe(false);
  await live.hover();
  await handleIn(live).click();
  await page.waitForTimeout(600);
  expect(await activeOf()).toBe(false);
  expect(context.pages().length).toBe(pagesBefore);

  // CONTROL: a click on the row itself does switch.
  await live.getByRole('button', { name: /^Switch to tab: Station/ }).click();
  await expect.poll(activeOf).toBe(true);
});

// KAN-704. A grouped tab's dots sit left of its group's band, so a press on
// them starts outside the band. Its group must still read as its own: the
// band lit as the drop target, and a release in place keeps the tab in it.
for (const pane of ['saved', 'Open now'] as const) {
  for (const on of ['dots', 'row'] as const) {
    test(`${pane}: a grouped tab picked up by its ${on} stays in its group${
      on === 'row' ? ' (control)' : ''
    }`, async ({ context, extensionId, serviceWorker }) => {
      const { page, block } = await openBoth(
        context,
        extensionId,
        serviceWorker
      );
      const row = outsideRow(
        page,
        block,
        pane === 'saved' ? 'saved grouped tab' : 'Open now grouped tab'
      );
      const band = row.locator('xpath=ancestor::*[@data-band-id][1]');
      await row.hover();
      const r = await boxOf(row);
      const at =
        on === 'dots'
          ? await centreOf(handleIn(row))
          : { x: r.x + 30, y: r.y + r.height / 2 };
      // PREMISE: the dots really are outside the band, the row inside it.
      const b = await boxOf(band);
      expect(at.x < b.x, 'press left of the band').toBe(on === 'dots');
      await page.mouse.move(at.x, at.y, { steps: 3 });
      await page.mouse.down();
      await page.mouse.move(at.x + 2, at.y + 10, { steps: 6 });
      await expect(page.locator('html[data-dragging="tab"]')).toHaveCount(1);
      await expect(band).toHaveAttribute('data-drop-target', '');
      await page.mouse.move(at.x, at.y, { steps: 6 });
      await page.mouse.up();
      await expect(page.locator('html[data-dragging]')).toHaveCount(0);
      if (pane === 'saved') {
        await page.waitForTimeout(300);
        const tab = (await stored(page)).tabGroups
          .flatMap((g) => g.windows)
          .flatMap((w) => w.tabs)
          .find((t) => t.tabId === 'gr-t0');
        expect(tab?.chromeGroupId).toBe('gr');
      } else {
        await page.waitForTimeout(500);
        const groupId = await serviceWorker.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ title: 'Kiyomizu' });
          return tab?.groupId ?? null;
        });
        expect(groupId).not.toBe(-1);
        expect(groupId).not.toBeNull();
      }
    });
  }
}

// KAN-704, the other side: picked up by its dots, a grouped tab still leaves
// its group when the pointer travels left out of the band, as from the row.
test('a grouped tab picked up by its dots and moved left out of its band leaves the group', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, block } = await openBoth(context, extensionId, serviceWorker);
  const row = outsideRow(page, block, 'saved grouped tab');
  const band = row.locator('xpath=ancestor::*[@data-band-id][1]');
  await row.hover();
  const at = await centreOf(handleIn(row));
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(at.x + 2, at.y + 10, { steps: 6 });
  // CONTROL: in place it is the band's.
  await expect(band).toHaveAttribute('data-drop-target', '');
  // PREMISE: the row starts less than 30px right of the band's edge, so 30px
  // of travel left takes the row's edge out of the band.
  const bandLeft = (await boxOf(band)).x;
  const rowLeft = (await boxOf(row)).x;
  expect(rowLeft - bandLeft).toBeGreaterThan(0);
  expect(rowLeft - bandLeft).toBeLessThan(30);
  await page.mouse.move(at.x - 30, at.y + 10, { steps: 6 });
  await expect(band).not.toHaveAttribute('data-drop-target');
  await page.mouse.move(at.x, at.y, { steps: 6 });
  await page.mouse.up();
});
