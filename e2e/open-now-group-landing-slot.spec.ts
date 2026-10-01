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
