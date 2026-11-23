import type { Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { test as freshTest } from './fixtures/extension';
import { openSaved, savedWindow, session } from './fixtures/savedWindows';
import { documentLanded } from './fixtures/landed';
import {
  between,
  samples,
  startSampling,
  topOf,
} from './fixtures/glideSamples';
import { pickUp, saveRowAim } from './fixtures/sessionDrag';
import { carryOutLeft } from './fixtures/betweenSessions';
import { standIn } from './fixtures/standInPages';
import { openPopup } from './fixtures/onboarding';
import {
  cardButton,
  seedRawSettingsIfAbsent,
  seedSessionsIfAbsent,
  startRunFromHelp,
} from './fixtures/run';
import { buildContainer, buildSession } from './fixtures/seed';

// KAN-988: every new session arrives the same way. His pick B (round 4): the
// new row comes down from under the list's top edge with the sessions below
// it; nothing fades, so it never reads as a flash. A drop on New session keeps
// its preview (the gap opens on hover, round 3 B) and the row slides into that
// gap (round 5 B). From the keyboard and under Reduce motion it is instant.

const SESSIONS = [
  session('S1', 'Trip', [
    savedWindow('w1', 'Flights', 2),
    savedWindow('w2', 'Food', 3),
  ]),
  ...['S2', 'S3', 'S4'].map((id) =>
    session(id, `Session ${id}`, [savedWindow(`${id}-w`, 'Window', 2)])
  ),
];
const FIRST_ROW = '[data-pane="sessions"] [data-drag-row-id]';
const rowOf = (id: string) =>
  `[data-pane="sessions"] [data-drag-row-id="${id}"]`;

// The first row's opacity in between fully hidden and fully shown: it faded in.
const faded = (ops: number[]) => ops.some((v) => v > 0.05 && v < 0.95);

// The new row's top on each frame strictly between a row above its place and its place: it slid in.
const slidIn = (tops: number[], place: number, by: number) =>
  between(tops, place - by, place).length >= 3;

async function popupOverATab(
  context: Parameters<typeof openSaved>[0],
  extensionId: string
): Promise<Page> {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
    overOrdinaryTab: true,
  });
  await documentLanded(page);
  return page;
}

// Records, every frame from now, whether the header mark's shutter moves.
async function watchShutter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = { slid: false };
    Reflect.set(globalThis, '__shutter', seen);
    const tick = () => {
      for (const a of document.getAnimations()) {
        const target =
          a.effect instanceof KeyframeEffect ? a.effect.target : null;
        if (target?.hasAttribute('data-mark-part')) seen.slid = true;
      }
      if (!seen.slid) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const shutterSlid = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__shutter');
    return typeof seen === 'object' && seen !== null && 'slid' in seen
      ? seen.slid === true
      : false;
  });

const saveAll = (page: Page) =>
  page.getByRole('button', {
    name: 'Save all open windows as a session',
    exact: true,
  });

test.describe('saving a new session', () => {
  test('the new row slides in from the top with the sessions below, without a fade', async ({
    context,
    extensionId,
  }) => {
    const page = await popupOverATab(context, extensionId);
    const from = await topOf(page.locator(rowOf('S1')));

    await startSampling(page, {
      next: rowOf('S1'),
      new: FIRST_ROW,
      'new:op': FIRST_ROW,
    });
    await saveAll(page).click();
    const s = await samples(page);
    const to = await topOf(page.locator(rowOf('S1')));

    expect(to - from).toBeGreaterThan(40);
    expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
    expect(slidIn(s.new, from, to - from)).toBe(true);
    expect(faded(s['new:op'])).toBe(false);
  });

  test('with Enter in the name field it is instant', async ({
    context,
    extensionId,
  }) => {
    const page = await popupOverATab(context, extensionId);
    const from = await topOf(page.locator(rowOf('S1')));
    await page
      .getByRole('textbox', { name: 'Name the new session' })
      .fill('Lisbon');

    await startSampling(page, {
      next: rowOf('S1'),
      new: FIRST_ROW,
      'new:op': FIRST_ROW,
    });
    await page.keyboard.press('Enter');
    const s = await samples(page);
    const to = await topOf(page.locator(rowOf('S1')));

    expect(to - from).toBeGreaterThan(40);
    expect(between(s.next, from, to)).toEqual([]);
    expect(faded(s['new:op'])).toBe(false);
  });

  test('with Reduce motion it is instant', async ({ context, extensionId }) => {
    const page = await popupOverATab(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const from = await topOf(page.locator(rowOf('S1')));

    await startSampling(page, {
      next: rowOf('S1'),
      new: FIRST_ROW,
      'new:op': FIRST_ROW,
    });
    await saveAll(page).click();
    const s = await samples(page);
    const to = await topOf(page.locator(rowOf('S1')));

    expect(to - from).toBeGreaterThan(40);
    expect(between(s.next, from, to)).toEqual([]);
    expect(faded(s['new:op'])).toBe(false);
  });

  test("Currently open's Save window does the same", async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: SESSIONS,
      overOrdinaryTab: true,
    });
    await documentLanded(page);
    const from = await topOf(page.locator(rowOf('S1')));

    await startSampling(page, {
      next: rowOf('S1'),
      new: FIRST_ROW,
      'new:op': FIRST_ROW,
    });
    await page
      .locator('[data-pane="open-now"]')
      .getByRole('button', { name: /^Save window as a session: / })
      .first()
      .click();
    const s = await samples(page);
    const to = await topOf(page.locator(rowOf('S1')));

    expect(to - from).toBeGreaterThan(40);
    expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
    expect(slidIn(s.new, from, to - from)).toBe(true);
    expect(faded(s['new:op'])).toBe(false);
  });
});

// Currently open in the tab view, beside a saved list S1-S4.
async function tabViewOverATab(
  context: Parameters<typeof openSaved>[0],
  extensionId: string
): Promise<Page> {
  const page = await openSaved(context, extensionId, 'tab view', {
    sessions: SESSIONS,
    overOrdinaryTab: true,
  });
  await documentLanded(page);
  return page;
}

// Clicks `press` and checks the saved list: the new row slides in from the top with S1 below it.
async function arrivesAsASave(page: Page, press: () => Promise<void>) {
  const from = await topOf(page.locator(rowOf('S1')));
  await startSampling(page, {
    next: rowOf('S1'),
    new: FIRST_ROW,
    'new:op': FIRST_ROW,
  });
  await press();
  const s = await samples(page);
  const to = await topOf(page.locator(rowOf('S1')));
  expect(to - from).toBeGreaterThan(40);
  expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
  expect(slidIn(s.new, from, to - from)).toBe(true);
  expect(faded(s['new:op'])).toBe(false);
}

test.describe('Currently open saves', () => {
  test('Save all from its header', async ({ context, extensionId }) => {
    const page = await tabViewOverATab(context, extensionId);
    await arrivesAsASave(page, () =>
      page
        .locator('[data-pane="open-now"]')
        .getByRole('button', {
          name: 'Save all open windows as a session',
          exact: true,
        })
        .click()
    );
    await expect(page.locator(FIRST_ROW).first()).not.toHaveAttribute(
      'data-drag-row-id',
      /^S[1-4]$/
    );
  });

  test("a live group's Save", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await tabViewOverATab(context, extensionId);
    await serviceWorker.evaluate(async (urls) => {
      const win = await chrome.windows.create({ url: urls, focused: false });
      const ids = (win?.tabs ?? []).map((t) => t.id ?? -1);
      const [a, ...rest] = ids;
      if (a === undefined || win?.id === undefined) return;
      const g = await chrome.tabs.group({
        tabIds: [a, ...rest],
        createProperties: { windowId: win.id },
      });
      await chrome.tabGroups.update(g, { title: 'Kyoto', color: 'blue' });
    }, ['Temples', 'Gardens'].map(standIn));
    const kyoto = page
      .locator('[data-pane="open-now"]')
      .getByRole('group', { name: 'Kyoto', exact: true });
    await expect(kyoto).toBeVisible();
    await documentLanded(page);
    await arrivesAsASave(page, async () => {
      await kyoto.locator('[data-group-drag-handle]').hover();
      await kyoto
        .getByRole('button', {
          name: 'Save group as a session: Kyoto',
          exact: true,
        })
        .click();
    });
  });
});

test.describe('a drop on New session', () => {
  test('the gap opens on the ease-out curve, and the new row slides into it', async ({
    context,
    extensionId,
  }) => {
    const page = await popupOverATab(context, extensionId);
    const at = await pickUp(
      page,
      page.locator('[data-pane="detail"] [data-drag-row-id="w2-t0"]')
    );
    await carryOutLeft(page, at);
    const aim = await saveRowAim(page);
    await page.mouse.move(aim.x, aim.y, { steps: 6 });
    await expect(page.locator('[data-new-session-place]')).toBeAttached();
    const slot = page.locator('[data-new-session-slot]');
    expect(
      await slot.evaluate((el) => getComputedStyle(el).transitionTimingFunction)
    ).toBe('cubic-bezier(0.23, 1, 0.32, 1)');
    await documentLanded(page);

    await watchShutter(page);
    await startSampling(page, { new: FIRST_ROW, 'new:op': FIRST_ROW });
    await page.mouse.up();
    const s = await samples(page);
    // The header mark's shutter slides, as for every new session (KAN-388).
    await expect.poll(() => shutterSlid(page)).toBe(true);
    const place = await topOf(page.locator(FIRST_ROW).first());
    const pitch = (await topOf(page.locator(rowOf('S1')))) - place;

    await expect(page.locator(FIRST_ROW).first()).not.toHaveAttribute(
      'data-drag-row-id',
      /^S[1-4]$/
    );
    expect(slidIn(s.new, place, pitch)).toBe(true);
    expect(faded(s['new:op'])).toBe(false);
  });
});

freshTest.describe("the tour's example session", () => {
  freshTest.use({ freshProfile: true });

  freshTest('arrives the same way', async ({ context, extensionId }) => {
    await seedRawSettingsIfAbsent(context, {
      cloudConsent: 'granted',
      isAutoSync: false,
      isPinGuideDismissed: true,
      isFullViewCalloutSeen: true,
      isWhatsNew2Seen: true,
    });
    await seedSessionsIfAbsent(
      context,
      buildContainer([
        buildSession({ tabGroupId: 'kept', title: 'Kept' }),
        buildSession({ tabGroupId: 'kept2', title: 'Also kept' }),
      ])
    );
    const popup = await openPopup(context, extensionId);
    await startRunFromHelp(popup);
    const kept = popup.locator(rowOf('kept'));
    await expect(kept).toBeVisible();
    await documentLanded(popup);
    const from = await topOf(kept);

    await startSampling(popup, {
      next: rowOf('kept'),
      new: FIRST_ROW,
      'new:op': FIRST_ROW,
    });
    await cardButton(popup, 'Use an example').click();
    const s = await samples(popup);
    const to = await topOf(kept);

    expect(to - from).toBeGreaterThan(40);
    expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
    expect(slidIn(s.new, from, to - from)).toBe(true);
    expect(faded(s['new:op'])).toBe(false);
  });
});
