import type { Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';

// KAN-360 in OPEN NOW. Its `items` list is the saved pane's, over real
// windows: the held group folds to its title row (data-group-tabs) and every
// other group is drawn whole, so it reaches the same landingDeltaOf and drew
// the same slot -- on the top of the last group passed, over its rows, while
// Chrome moved the group to that group's end.
//
// A real window, staged unfocused so the tab view stays in front: a0, then
// the groups Alpha (one tab), Beta (three) and Gamma (two). Alpha is held
// down; Gamma is held up as the CONTROL. Aimed in the FOLDED layout the drag
// measured, read after pick-up and before anything has stepped aside.

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

interface Staged {
  windowId: number;
  alpha: number;
  beta: number;
  gamma: number;
}

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
    const [, al0, be0, be1, be2, ga0, ga1] = ids;
    if (
      al0 === undefined ||
      be0 === undefined ||
      be1 === undefined ||
      be2 === undefined ||
      ga0 === undefined ||
      ga1 === undefined
    )
      return null;
    return {
      windowId,
      alpha: await group([al0], 'Alpha', 'blue'),
      beta: await group([be0, be1, be2], 'Beta', 'red'),
      gamma: await group([ga0, ga1], 'Gamma', 'green'),
    };
  }, ['a0', 'al0', 'be0', 'be1', 'be2', 'ga0', 'ga1'].map(dataUrl));
  if (staged === null) throw new Error('Chrome gave no window, tab or group');
  return staged;
}

// Until every row the preview moved has arrived: two frames, then each
// running transition's own end, until none is left.
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
    for (;;) {
      const running = document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition && a.playState === 'running');
      if (running.length === 0) return;
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
      await frame();
    }
  });
}

const inWindow = (staged: Staged) =>
  `[data-open-window-id="${staged.windowId}"]`;
const band = (staged: Staged, groupId: number) =>
  `${inWindow(staged)} [data-band-id="${groupId}"]`;

async function spanOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} is not drawn`);
  return { top: box.y, bottom: box.y + box.height };
}

const bandOrder = (page: Page, staged: Staged) =>
  page.evaluate(
    (scope) =>
      [
        ...document.querySelectorAll<HTMLElement>(`${scope} [data-band-id]`),
      ].map((el) => Number(el.dataset.bandId)),
    inWindow(staged)
  );

// The slot, and every row it must not sit on: each tab row and group title
// row in the window that is drawn and is not the held group's.
async function preview(page: Page, staged: Staged) {
  return page.evaluate((scope) => {
    const span = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, height: b.height };
    };
    const slot = document.querySelector('[data-drag-landing-slot]');
    const held = document.querySelector('[data-drag-held]');
    const rows = [
      ...document.querySelectorAll(
        `${scope} [data-drag-row-id]:not([data-drag-row-id^="group:"]), ${scope} [data-band-id] [data-fixed-row-id]`
      ),
    ].flatMap((el) => {
      if (!(el instanceof HTMLElement)) return [];
      if (held !== null && held.contains(el)) return [];
      const s = span(el);
      if (s.height <= 0) return [];
      return [
        {
          key: el.dataset.dragRowId ?? el.dataset.fixedRowId ?? '?',
          top: s.top,
          bottom: s.bottom,
        },
      ];
    });
    return { slot: slot === null ? null : span(slot), rows };
  }, inWindow(staged));
}

function overlapped(p: Awaited<ReturnType<typeof preview>>): string[] {
  const slot = p.slot;
  if (slot === null) return ['no slot drawn'];
  return p.rows
    .filter(
      (r) => Math.min(r.bottom, slot.bottom) - Math.max(r.top, slot.top) > 1
    )
    .map((r) => `${r.key} ${r.top}..${r.bottom}`);
}

interface Case {
  name: string;
  held: (s: Staged) => number;
  aimInto: (s: Staged) => number;
  frac: number;
  landsAs: (s: Staged) => number[];
}

const CASES: Case[] = [
  {
    name: 'down past a taller group',
    held: (s) => s.alpha,
    aimInto: (s) => s.beta,
    frac: 0.75,
    landsAs: (s) => [s.beta, s.alpha, s.gamma],
  },
  // INSIDE the list: past its end the release lands back at its own place.
  {
    name: "down to the window's end",
    held: (s) => s.alpha,
    aimInto: (s) => s.gamma,
    frac: 0.75,
    landsAs: (s) => [s.beta, s.gamma, s.alpha],
  },
  {
    name: 'CONTROL: up past a taller group',
    held: (s) => s.gamma,
    aimInto: (s) => s.beta,
    frac: 0.25,
    landsAs: (s) => [s.alpha, s.gamma, s.beta],
  },
];

test.describe('in Open now, a dragged group is shown landing where it lands', () => {
  for (const c of CASES) {
    test(c.name, async ({ context, extensionId, serviceWorker }) => {
      const staged = await stage(serviceWorker);
      const page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
      // goto resolves before React mounts (KAN-105).
      await expect
        .poll(() => bandOrder(page, staged))
        .toEqual([staged.alpha, staged.beta, staged.gamma]);
      await settled(page);

      const held = c.held(staged);
      const handle = await page
        .locator(`${band(staged, held)} [data-group-drag-handle]`)
        .boundingBox();
      if (handle === null) throw new Error('the group has no title row');
      const x = handle.x + 40;
      const y = handle.y + handle.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 8, { steps: 2 });
      // PREMISE: this group is held, drawn (Open now shows no card), folded.
      const heldEl = page.locator('[data-drag-held]');
      await expect(heldEl).toHaveAttribute('data-drag-row-id', `group:${held}`);
      await expect(heldEl).not.toHaveAttribute('data-held-as-card');
      await settled(page);

      const target = await spanOf(page, band(staged, c.aimInto(staged)));
      await page.mouse.move(
        x,
        target.top + (target.bottom - target.top) * c.frac,
        { steps: 12 }
      );
      await settled(page);
      const shown = await preview(page, staged);
      await page.mouse.up();

      await expect
        .poll(() => bandOrder(page, staged))
        .toEqual(c.landsAs(staged));
      await settled(page);
      const landed = await spanOf(
        page,
        `${band(staged, held)} [data-group-drag-handle]`
      );

      const slotTop = shown.slot?.top ?? Number.NaN;
      console.log(
        `Open now ${c.name}: slot ${slotTop}..${shown.slot
          ?.bottom}, landed title row ${landed.top}..${
          landed.bottom
        }, slot sits on [${overlapped(shown).join(', ')}]`
      );
      expect(Math.abs(slotTop - landed.top)).toBeLessThanOrEqual(1);
      expect(overlapped(shown)).toEqual([]);
    });
  }
});

// KAN-364. A tab's slot is the box of the row it becomes: a member's inside
// a band, which starts past the colour bar, and a loose row's outside one.
// The held row's own box says neither once the tab crosses a band's edge.
const tabRowOf = (page: Page, staged: Staged, title: string) =>
  page.evaluate(
    ([scope, title]) => {
      // The innermost row whose text is this tab's: its icon, title and close
      // control (data: tabs have no favicon, so the globe).
      const row = [
        ...document.querySelectorAll<HTMLElement>(
          `${scope} [data-drag-row-id]`
        ),
      ].find(
        (r) =>
          r.querySelector('[data-drag-row-id]') === null &&
          (r.textContent ?? '').trim() === `globe${title}close`
      );
      if (row === undefined) return null;
      const b = row.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, height: b.height };
    },
    [inWindow(staged), title] as const
  );

test.describe("in Open now, a tab's slot is the box of the row it becomes (KAN-364)", () => {
  const cases = [
    {
      name: 'a loose tab into a band',
      held: 'a0',
      aim: 'be1',
      frac: 0.5,
      becomes: 'member',
    },
    {
      name: 'a member out of its band, to a loose spot',
      held: 'be0',
      aim: 'a0',
      frac: 0.3,
      becomes: 'loose',
    },
    {
      name: 'CONTROL: a member within its band',
      held: 'be0',
      aim: 'be2',
      frac: 0.6,
      becomes: 'member',
    },
  ] as const;
  for (const c of cases) {
    test(c.name, async ({ context, extensionId, serviceWorker }) => {
      const staged = await stage(serviceWorker);
      const page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
      // goto resolves before React mounts (KAN-105).
      await expect
        .poll(() => bandOrder(page, staged))
        .toEqual([staged.alpha, staged.beta, staged.gamma]);
      await settled(page);
      const member = await tabRowOf(page, staged, 'be2');
      const loose = await tabRowOf(page, staged, 'a0');
      const held = await tabRowOf(page, staged, c.held);
      if (member === null || loose === null || held === null)
        throw new Error('a staged tab is not drawn');
      // PREMISE: the two boxes differ, so the slot can only match one.
      expect(member.left - loose.left).toBeGreaterThan(8);
      const x = held.left + 60;
      const y = held.top + held.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 8, { steps: 2 });
      await settled(page);
      const aim = await tabRowOf(page, staged, c.aim);
      if (aim === null) throw new Error(`${c.aim} is not drawn`);
      await page.mouse.move(x, aim.top + aim.height * c.frac, { steps: 12 });
      await settled(page);
      const slot = await page.evaluate(() => {
        const b = document
          .querySelector('[data-drag-landing-slot]')
          ?.getBoundingClientRect();
        return b === undefined ? null : { left: b.left, right: b.right };
      });
      if (slot === null) throw new Error('no landing slot drawn');
      const want = c.becomes === 'member' ? member : loose;
      // To within one LayoutUnit (1/64px), as in drag-between-sessions: a
      // box under a transform has its subpixel offset snapped.
      expect(
        Math.abs(slot.left - want.left),
        `slot left ${slot.left} vs ${want.left}`
      ).toBeLessThanOrEqual(1 / 64);
      expect(
        Math.abs(slot.right - want.right),
        `slot right ${slot.right} vs ${want.right}`
      ).toBeLessThanOrEqual(1 / 64);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }
});

// A refused release goes back where it came from, so its slot is the held
// row's own box, even with the pointer over another window's band (KAN-364).
// A pinned tab is refused by every window but its own (K1). The band under
// the pointer is in the refused window, which the drop rule never searches
// (dropRoot), so it names no band, and the slot cannot take a member's box.
test("in Open now, a pinned tab held over another window's band keeps its own box", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const ids = await serviceWorker.evaluate(
    async (urls: string[][]) => {
      const [a, b] = await Promise.all(
        urls.map((url) => chrome.windows.create({ focused: false, url }))
      );
      const aTabs = (a?.tabs ?? []).flatMap((t) =>
        t.id === undefined ? [] : [t.id]
      );
      const bTabs = (b?.tabs ?? []).flatMap((t) =>
        t.id === undefined ? [] : [t.id]
      );
      const [pinned] = aTabs;
      const [, m0, m1] = bTabs;
      if (
        a?.id === undefined ||
        b?.id === undefined ||
        pinned === undefined ||
        m0 === undefined ||
        m1 === undefined
      )
        return null;
      await chrome.tabs.update(pinned, { pinned: true });
      const group = await chrome.tabs.group({
        tabIds: [m0, m1],
        createProperties: { windowId: b.id },
      });
      await chrome.tabGroups.update(group, { title: 'Members', color: 'blue' });
      return { a: a.id, b: b.id, group };
    },
    [['pp0', 'pa1'].map(dataUrl), ['pb0', 'pm0', 'pm1'].map(dataUrl)]
  );
  if (ids === null) throw new Error('Chrome gave no window, tab or group');
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const bandSel = `[data-open-window-id="${ids.b}"] [data-band-id="${ids.group}"]`;
  // goto resolves before React mounts (KAN-105).
  await expect(page.locator(bandSel)).toBeVisible();
  await settled(page);
  // The pinned tab's row: the innermost row in window A holding its title.
  const pinnedRow = () =>
    page.evaluate((scope) => {
      const row = [
        ...document.querySelectorAll<HTMLElement>(
          `${scope} [data-drag-row-id]`
        ),
      ].find(
        (r) =>
          r.querySelector('[data-drag-row-id]') === null &&
          (r.textContent ?? '').includes('pp0')
      );
      if (row === undefined) return null;
      const b = row.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, height: b.height };
    }, `[data-open-window-id="${ids.a}"]`);
  const own = await pinnedRow();
  if (own === null) throw new Error('the pinned tab is not drawn');
  const member = await page
    .locator(`${bandSel} [data-drag-row-id]`)
    .last()
    .boundingBox();
  if (member === null) throw new Error('the band has no member drawn');
  // PREMISE: a member's box differs from the pinned tab's, so a slot drawn
  // as a member's could not pass for the pinned tab's own.
  expect(member.x - own.left).toBeGreaterThan(8);
  const x = own.left + 60;
  const y = own.top + own.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8, { steps: 2 });
  await settled(page);
  await page.mouse.move(member.x + 60, member.y + member.height / 2, {
    steps: 12,
  });
  await settled(page);
  // PREMISE: the release is refused -- the slot is back at the pinned tab's
  // own place, not among the members.
  const slot = await page.evaluate(() => {
    const b = document
      .querySelector('[data-drag-landing-slot]')
      ?.getBoundingClientRect();
    return b === undefined
      ? null
      : { left: b.left, right: b.right, top: b.top };
  });
  if (slot === null) throw new Error('no landing slot drawn');
  expect(Math.abs(slot.top - own.top)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(slot.left - own.left),
    `slot left ${slot.left} vs ${own.left}`
  ).toBeLessThanOrEqual(1 / 64);
  expect(
    Math.abs(slot.right - own.right),
    `slot right ${slot.right} vs ${own.right}`
  ).toBeLessThanOrEqual(1 / 64);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});
