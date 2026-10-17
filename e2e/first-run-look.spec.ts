import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { hasCloudConfig } from './fixtures/cloud';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { FULL, FULL_VIEW_PATH, POPUP, openPage } from './fixtures/onboarding';
import {
  FULL_AT_HELLO,
  card,
  cardAt,
  hello,
  landedAt,
  replayNote,
  startRunFromHelp,
} from './fixtures/run';
import { CONTROL, TYPE } from '../src/styles/scale';

// KAN-654. What worked on the review card (KAN-653), carried to setup, the
// cloud question and the first run, as Justine picked them in mock rounds 1-5.

const DAY = 24 * 60 * 60 * 1000;
const VIEWS = {
  popup: { path: 'index.html', viewport: POPUP },
  full: { path: FULL_VIEW_PATH, viewport: FULL },
} as const;
type View = keyof typeof VIEWS;
const SESSIONS = buildContainer(
  ['Trip planning', 'Reading list'].map((title, i) =>
    buildSession({ tabGroupId: `s${i}`, title })
  )
);
const px = (rem: string) => parseFloat(rem) * 16;

const setup = (page: Page) =>
  page.locator('dialog[aria-labelledby="setup-title"]');
const button = (scope: Locator, name: string) =>
  scope.getByRole('button', { name, exact: true });
// Once whatever carries it has arrived: a card grows from 97% as it appears.
// Its ancestors only, so the welcome drawing's loop beside it is not waited on.
const box = async (locator: Locator) => {
  await locator.evaluate(async (el) => {
    const rising: Animation[] = [];
    for (let at: Element | null = el; at !== null; at = at.parentElement) {
      rising.push(...at.getAnimations());
    }
    await Promise.all(rising.map((a) => a.finished));
  });
  const b = await locator.boundingBox();
  if (b === null) throw new Error('not drawn');
  return b;
};

// Setup's second step, so Back shows.
async function openSetupStep2(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSettings(context, { setupState: 'pending' });
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  const heading = setup(page).getByRole('heading', { level: 3 });
  const first = await heading.textContent();
  await button(setup(page), 'Next').click();
  await expect(heading).not.toHaveText(first ?? '');
  return page;
}

// Settings → Sync & Backup → Auto Sync On asks the plain question.
async function openSyncQuestion(
  context: BrowserContext,
  extensionId: string,
  view: View
): Promise<{ page: Page; dialog: Locator }> {
  await seedSettings(context, { cloudConsent: 'declined', isAutoSync: false });
  const page = await openPage(
    context,
    extensionId,
    VIEWS[view].path,
    VIEWS[view].viewport
  );
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & backup"]').click();
  await page
    .getByRole('group', { name: 'Auto sync' })
    .getByRole('button', { name: 'On', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Sync your sessions across devices?',
  });
  await expect(dialog).toBeVisible();
  return { page, dialog };
}

// The run's second card, so Back shows.
async function openTourStep2(
  context: BrowserContext,
  extensionId: string,
  view: View
): Promise<Page> {
  await seedSessions(context, SESSIONS);
  await seedSettings(context, {});
  const page = await openPage(
    context,
    extensionId,
    VIEWS[view].path,
    VIEWS[view].viewport
  );
  await startRunFromHelp(page);
  await landedAt(page, 1);
  await cardAt(page, 1)
    .getByRole('button', { name: /^(Next|Use an example)$/ })
    .click();
  await landedAt(page, 2);
  return page;
}

// From document start: whether the centre of the first element matching
// `selector` hits it as it arrives, and once it has landed. Recorded in the
// page, where the timing is the element's own, not the harness's round trip.
async function watchArrival(
  context: BrowserContext,
  selector: string
): Promise<void> {
  await context.addInitScript((sel: string) => {
    if (window !== window.top) return;
    const hits: { arriving?: boolean; landed?: boolean } = {};
    Object.defineProperty(globalThis, '__arrivalHits', { value: hits });
    const hitsIt = (el: Element) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2
      );
      return at !== null && el.contains(at);
    };
    // Landed: no animation left on it, then a frame for the re-render.
    const whenStill = (el: Element) => {
      if (el.getAnimations().some((a) => a.playState === 'running')) {
        requestAnimationFrame(() => whenStill(el));
        return;
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          hits.landed = hitsIt(el);
        })
      );
    };
    new MutationObserver(() => {
      const el = document.querySelector(sel);
      if (el === null || hits.arriving !== undefined) return;
      hits.arriving = hitsIt(el);
      whenStill(el);
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open', 'aria-hidden'],
    });
  }, selector);
}
const arrivalHits = (page: Page) =>
  page.evaluate(() => {
    const hits: unknown = Reflect.get(globalThis, '__arrivalHits');
    return typeof hits === 'object' && hits !== null
      ? {
          arriving: Reflect.get(hits, 'arriving'),
          landed: Reflect.get(hits, 'landed'),
        }
      : null;
  });

test.describe('setup and the cloud question take the one weight', () => {
  test('setup: the title and the step heading are not bold', async ({
    context,
    extensionId,
  }) => {
    const page = await openSetupStep2(context, extensionId);
    for (const level of [2, 3]) {
      await expect(setup(page).getByRole('heading', { level })).toHaveCSS(
        'font-weight',
        '400'
      );
    }
  });

  test('the cloud question: the title is not bold', async ({
    context,
    extensionId,
  }) => {
    const { dialog } = await openSyncQuestion(context, extensionId, 'popup');
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveCSS(
      'font-weight',
      '400'
    );
  });
});

test.describe('the first run’s buttons are the control height', () => {
  const HEIGHT = parseFloat(CONTROL.DEFAULT);

  test('setup: Back and Next', async ({ context, extensionId }) => {
    const page = await openSetupStep2(context, extensionId);
    for (const name of ['Back', 'Next']) {
      expect((await box(button(setup(page), name))).height).toBe(HEIGHT);
    }
  });

  for (const view of ['popup', 'full'] as const) {
    test(`${view}: the cloud question's Not now and Sync`, async ({
      context,
      extensionId,
    }) => {
      const { dialog } = await openSyncQuestion(context, extensionId, view);
      for (const name of ['Not now', 'Sync']) {
        expect((await box(button(dialog, name))).height).toBe(HEIGHT);
      }
    });

    test(`${view}: the tour card's Back and Next, and the replay note's Got it`, async ({
      context,
      extensionId,
    }) => {
      const page = await openTourStep2(context, extensionId, view);
      for (const name of ['Back', 'Next']) {
        expect((await box(button(card(page), name))).height).toBe(HEIGHT);
      }
      await page.keyboard.press('Escape');
      await expect(replayNote(page)).toBeVisible();
      expect((await box(button(replayNote(page), 'Got it'))).height).toBe(
        HEIGHT
      );
    });

    test(`${view}: Hello's Start`, async ({ context, extensionId }) => {
      await seedSettings(context, {
        firstRun:
          view === 'full'
            ? FULL_AT_HELLO
            : { ...FULL_AT_HELLO, view, hello: 'whatsNew', welcomeShows: 1 },
        isWhatsNew2Seen: false,
      });
      const page = await openPage(
        context,
        extensionId,
        VIEWS[view].path,
        VIEWS[view].viewport
      );
      await expect(hello(page)).toBeVisible();
      expect((await box(button(hello(page), 'Start'))).height).toBe(HEIGHT);
    });
  }

  test('the synced user’s Turn off sync and Keep sync on', async ({
    context,
    extensionId,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    // Sessions make an existing user; without them it is a new install.
    await seedSessions(context, SESSIONS);
    await seedSettings(context, {
      cloudConsent: '',
      extensionInstalledTime: Date.now() - 30 * DAY,
    });
    const page = await openPage(context, extensionId, 'index.html', POPUP);
    const dialog = page.getByRole('dialog', {
      name: 'Your sessions are currently synced',
    });
    await expect(dialog).toBeVisible();
    for (const name of ['Turn off sync', 'Keep sync on']) {
      expect((await box(button(dialog, name))).height).toBe(HEIGHT);
    }
  });

  test.describe('on a new install', () => {
    test.use({ freshProfile: true });
    test('the welcome’s Get started', async ({ context, extensionId }) => {
      const page = await context.newPage();
      await page.setViewportSize(POPUP);
      await page.goto(`chrome-extension://${extensionId}/index.html`);
      const dialog = page.getByRole('dialog', {
        name: 'Welcome to Tab Keeper',
      });
      await expect(dialog).toBeVisible();
      expect((await box(button(dialog, 'Get started'))).height).toBe(HEIGHT);
    });

    test('the welcome drawing is 168px tall', async ({
      context,
      extensionId,
    }) => {
      const page = await context.newPage();
      await page.setViewportSize(POPUP);
      await page.goto(`chrome-extension://${extensionId}/index.html`);
      const hero = page.locator('[data-hero-frame="start"]');
      await expect(hero).toBeVisible();
      expect((await box(hero)).height).toBe(168);
    });
  });
});

// Half as wide again, in any language: the grid sizes from the longer label.
const expectRatio = async (secondary: Locator, primary: Locator) => {
  const [s, p] = [await box(secondary), await box(primary)];
  expect(Math.abs(p.width - 1.5 * s.width)).toBeLessThanOrEqual(1);
  // Side by side, the primary on the right.
  expect(Math.abs(p.y - s.y)).toBeLessThanOrEqual(1);
  expect(p.x).toBeGreaterThan(s.x + s.width);
};

test.describe('the primary is half as wide again as its secondary', () => {
  test('setup: Next and Back', async ({ context, extensionId }) => {
    const page = await openSetupStep2(context, extensionId);
    await expectRatio(button(setup(page), 'Back'), button(setup(page), 'Next'));
  });

  for (const view of ['popup', 'full'] as const) {
    test(`${view}: the cloud question's Sync and Not now`, async ({
      context,
      extensionId,
    }) => {
      const { dialog } = await openSyncQuestion(context, extensionId, view);
      await expectRatio(button(dialog, 'Not now'), button(dialog, 'Sync'));
    });

    test(`${view}: the tour card's Next and Back`, async ({
      context,
      extensionId,
    }) => {
      const page = await openTourStep2(context, extensionId, view);
      await expectRatio(button(card(page), 'Back'), button(card(page), 'Next'));
    });
  }
});

test.describe('the tour card’s Skip tutorial sits under Back and Next', () => {
  for (const view of ['popup', 'full'] as const) {
    test(view, async ({ context, extensionId }) => {
      const page = await openTourStep2(context, extensionId, view);
      const skip = await box(button(card(page), 'Skip tutorial'));
      const next = await box(button(card(page), 'Next'));
      const mark = await box(card(page));
      expect(skip.y).toBeGreaterThanOrEqual(next.y + next.height);
      expect(
        Math.abs(skip.x + skip.width / 2 - (mark.x + mark.width / 2))
      ).toBeLessThanOrEqual(1);
    });
  }
});

test('setup’s Skip setup starts at the content edge', async ({
  context,
  extensionId,
}) => {
  const page = await openSetupStep2(context, extensionId);
  // By its words: the ✕ is named Skip setup too.
  const link = setup(page).locator('button', { hasText: 'Skip setup' });
  const words = await link.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().left;
  });
  const edge = (await box(setup(page).getByRole('heading', { level: 3 }))).x;
  expect(Math.abs(words - edge)).toBeLessThanOrEqual(0.5);
});

// Round 6: the full view's title and tour card are larger; padding stays as it was.
test.describe('the full view is a size up; the popup is as it was', () => {
  test('full view: setup has a title-size title and 20px padding', async ({
    context,
    extensionId,
  }) => {
    const page = await openSetupStep2(context, extensionId);
    await expect(setup(page)).toHaveCSS('padding', '20px');
    await expect(setup(page).getByRole('heading', { level: 2 })).toHaveCSS(
      'font-size',
      `${px(TYPE.TITLE)}px`
    );
  });

  for (const [view, pad, size] of [
    ['popup', '20px', TYPE.SECTION],
    ['full', '20px', TYPE.TITLE],
  ] as const) {
    test(`${view}: the cloud question has ${pad} padding and its title size`, async ({
      context,
      extensionId,
    }) => {
      const { dialog } = await openSyncQuestion(context, extensionId, view);
      await expect(dialog).toHaveCSS('padding', pad);
      await expect(dialog.getByRole('heading', { level: 2 })).toHaveCSS(
        'font-size',
        `${px(size)}px`
      );
    });
  }

  for (const [view, width, padding] of [
    ['popup', 290, '18px 16px 12px'],
    // Round 6: the full view's card is wider, not roomier; one padding in both views.
    ['full', 360, '18px 16px 12px'],
  ] as const) {
    test(`${view}: the tour card is ${width}px wide`, async ({
      context,
      extensionId,
    }) => {
      const page = await openTourStep2(context, extensionId, view);
      expect((await box(card(page))).width).toBe(width);
      await expect(card(page)).toHaveCSS('padding', padding);
    });
  }
});

test.describe('arrival', () => {
  test('setup rises, and a press during the rise is not setup’s', async ({
    context,
    extensionId,
  }) => {
    await watchArrival(context, 'dialog[aria-labelledby="setup-title"][open]');
    await seedSettings(context, { setupState: 'pending' });
    await openPage(context, extensionId, FULL_VIEW_PATH, FULL).then((page) =>
      expect
        .poll(() => arrivalHits(page))
        .toEqual({
          arriving: false,
          landed: true,
        })
    );
  });

  test('the cloud question rises, and a press during the rise is not its', async ({
    context,
    extensionId,
  }) => {
    await watchArrival(context, 'dialog[open]');
    const { page } = await openSyncQuestion(context, extensionId, 'popup');
    await expect
      .poll(() => arrivalHits(page))
      .toEqual({ arriving: false, landed: true });
  });

  test('under reduced motion, setup takes a press at once', async ({
    context,
    extensionId,
  }) => {
    await watchArrival(context, 'dialog[aria-labelledby="setup-title"][open]');
    await seedSettings(context, { setupState: 'pending' });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(FULL);
    await page.goto(`chrome-extension://${extensionId}/${FULL_VIEW_PATH}`);
    await expect
      .poll(() => arrivalHits(page))
      .toEqual({ arriving: true, landed: true });
  });

  test('the tour card takes no press while it appears', async ({
    context,
    extensionId,
  }) => {
    await watchArrival(context, '[data-coach-mark]:not([aria-hidden])');
    await seedSessions(context, SESSIONS);
    await seedSettings(context, {});
    const page = await openPage(context, extensionId, 'index.html', POPUP);
    await startRunFromHelp(page);
    await expect
      .poll(() => arrivalHits(page))
      .toEqual({ arriving: false, landed: true });
  });
});
