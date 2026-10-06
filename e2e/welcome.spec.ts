import { test, expect } from './fixtures/extension';
import {
  THEMES,
  openPopup,
  pageGround,
  storedSettings,
  waitForFullView,
} from './fixtures/onboarding';
import { seedSettings } from './fixtures/seed';
import { escapesPrevented, watchEscapes } from './fixtures/escapeProbe';
import { expectReadable } from './fixtures/textContrast';
import {
  cardAt,
  hello,
  runCheck,
  runDrawn,
  storedRun,
  watchRunDrawn,
} from './fixtures/run';

// §5 on the real build: a new install's welcome, with Try the full view folded in.

test.use({ freshProfile: true });

const welcome = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true });
const queueDone = (page: import('@playwright/test').Page) =>
  expect(page.locator('html')).toHaveAttribute('data-first-open', /.+/);

test('the welcome: hero, one line, the hint, Not now and Get started; the run recorded at the welcome', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await expect(welcome(page)).toBeVisible();
  await expect(welcome(page).locator('[data-hero-frame]')).toHaveAttribute(
    'aria-hidden',
    'true'
  );
  await expect(welcome(page)).toContainText(
    'Get started opens Tab Keeper in its own tab.'
  );
  await expect
    .poll(() => storedRun(page))
    .toEqual({
      view: 'popup',
      step: 0,
      sessionId: null,
      hello: 'welcome',
      welcomeShows: 1,
      ended: null,
    });
  expect(await storedSettings(page)).toMatchObject({
    cloudConsent: 'declined',
    setupState: 'pending',
  });
});

test('Not now: the popup run starts at its save card', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await welcome(page)
    .getByRole('button', { name: 'Not now', exact: true })
    .click();
  await expect(cardAt(page, 1)).toBeVisible();
});

test('Esc is Not now, and the popup keeps it (KAN-426)', async ({
  context,
  extensionId,
}) => {
  await watchEscapes(context);
  const page = await openPopup(context, extensionId);
  await expect(welcome(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cardAt(page, 1)).toBeVisible();
  expect(await escapesPrevented(page)).toEqual([true]);
});

for (const attempt of [1, 2, 3, 4, 5]) {
  test(`Get started opens the full view on Hello, every time (Review Focus 1, run ${attempt})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await welcome(page)
      .getByRole('button', { name: 'Get started', exact: true })
      .click();
    const full = await waitForFullView(context);
    await runCheck(full, 'resumed');
    await expect(hello(full)).toHaveAccessibleName('Welcome to Tab Keeper');
  });
}

test('Q7: closed unanswered, it shows once more; closed again, it ends and the popup is plain', async ({
  context,
  extensionId,
}) => {
  await watchRunDrawn(context);
  const first = await openPopup(context, extensionId);
  await expect(welcome(first)).toBeVisible();
  // CONTROL for the third open: the same observer saw this one's welcome.
  expect(await runDrawn(first)).toEqual(['cloudConsent']);
  await first.close();
  const second = await openPopup(context, extensionId);
  await runCheck(second, 'reshown');
  await expect(welcome(second)).toBeVisible();
  expect(await storedRun(second)).toMatchObject({ step: 0, welcomeShows: 2 });
  await second.close();
  const third = await openPopup(context, extensionId);
  await runCheck(third, 'unanswered');
  await queueDone(third);
  expect(await runDrawn(third)).toEqual([]);
  expect(await storedRun(third)).toMatchObject({ ended: 'unanswered' });
  expect((await storedSettings(third)).cloudConsent).toBe('declined');
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: the welcome reads at 4.5:1`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { cloudConsent: '', theme });
    const page = await openPopup(context, extensionId);
    expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
    await expectReadable(welcome(page), `${theme} Welcome`);
  });
}

interface Recorded {
  target: string;
  duration: number;
  delay: number;
  iterations: number;
}
const isRecorded = (value: unknown): value is Recorded =>
  typeof value === 'object' &&
  value !== null &&
  'target' in value &&
  typeof value.target === 'string' &&
  'duration' in value &&
  typeof value.duration === 'number' &&
  'delay' in value &&
  typeof value.delay === 'number' &&
  'iterations' in value &&
  typeof value.iterations === 'number';

// Records every animation started in this page from document start: its target and timing.
async function watchAnimations(
  context: import('@playwright/test').BrowserContext
) {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    const seen: {
      target: string;
      duration: number;
      delay: number;
      iterations: number;
    }[] = [];
    Object.defineProperty(globalThis, '__animations', { value: seen });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, keyframes, options) {
      const timing =
        typeof options === 'number' ? { duration: options } : options ?? {};
      seen.push({
        target:
          this.getAttribute('data-hero-part') ??
          (this.hasAttribute('data-run-hello')
            ? 'hello'
            : this.tagName.toLowerCase()),
        duration: Number(timing.duration ?? 0),
        delay: Number(timing.delay ?? 0),
        iterations: Number(timing.iterations ?? 1),
      });
      return animate.call(this, keyframes, options);
    };
  });
}
const animationsIn = async (page: import('@playwright/test').Page) => {
  const seen = await page.evaluate((): unknown =>
    Reflect.get(globalThis, '__animations')
  );
  return Array.isArray(seen) ? seen.filter(isRecorded) : [];
};
// Every animation on the hero's parts, as its play state.
const heroPlayStates = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter(
        (a) =>
          a.effect instanceof KeyframeEffect &&
          a.effect.target?.closest('[data-hero-frame]') != null
      )
      .map((a) => a.playState)
  );

test('the loop plays its beats once, all done by 2.4s', async ({
  context,
  extensionId,
}) => {
  await watchAnimations(context);
  const page = await openPopup(context, extensionId);
  await expect(welcome(page)).toBeVisible();
  const loop = (await animationsIn(page)).filter(
    (a) => a.target !== 'button' && a.target !== 'dialog'
  );
  expect(loop.length).toBe(21);
  expect(Math.max(...loop.map((a) => a.delay + a.duration))).toBe(2400);
  expect(loop.every((a) => a.iterations === 1)).toBe(true);
  // CONTROL: it is playing now, so "finished" below is not the page never having animated.
  expect(await heroPlayStates(page)).toContain('running');
  // Finished fill-forwards animations stay listed, so "nothing loops forever" is every one finished.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          document.getAnimations().every((a) => a.playState === 'finished')
        ),
      { timeout: 4000 }
    )
    .toBe(true);
});

test('Get started: the loop ends at once, the shutter beat and the exit play, and Hello enters in the full view', async ({
  context,
  extensionId,
}) => {
  await watchAnimations(context);
  const page = await openPopup(context, extensionId);
  await expect(welcome(page)).toBeVisible();
  // Click inside the page so the states are read in the same task as the press.
  const states = await page.evaluate(() => {
    const hero = () =>
      document
        .getAnimations()
        .filter(
          (a) =>
            a.effect instanceof KeyframeEffect &&
            a.effect.target?.closest('[data-hero-frame]') != null
        )
        .map((a) => a.playState);
    const before = hero();
    const button = [...document.querySelectorAll('dialog button')].find(
      (b) => b.textContent === 'Get started'
    );
    if (!(button instanceof HTMLElement)) throw new Error('no Get started');
    button.click();
    return { before, after: hero() };
  });
  expect(states.before).toContain('running');
  // The dips have no fill, so finishing them drops them from the list.
  expect(states.after.length).toBeGreaterThan(0);
  expect(states.after.every((s) => s === 'finished')).toBe(true);
  await expect
    .poll(async () => {
      const seen = await animationsIn(page);
      return [
        seen.some((a) => a.target === 'shutter' && a.duration === 250),
        seen.some((a) => a.target === 'dialog' && a.duration === 150),
      ];
    })
    .toEqual([true, true]);
  const full = await waitForFullView(context);
  await expect(hello(full)).toBeVisible();
  await expect
    .poll(async () =>
      (await animationsIn(full)).some(
        (a) => a.target === 'hello' && a.duration === 220
      )
    )
    .toBe(true);
});

test('Esc during the beat completes Get started (R12)', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await welcome(page)
    .getByRole('button', { name: 'Get started', exact: true })
    .click();
  await page.keyboard.press('Escape');
  const full = await waitForFullView(context);
  await expect(hello(full)).toBeVisible();
});

test('reduced motion: a still hero at its end, nothing animates, and Get started goes straight on', async ({
  context,
  extensionId,
}) => {
  await watchAnimations(context);
  // Emulated before the app mounts: the hero's frame is decided once, at mount.
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(welcome(page).locator('[data-hero-frame="end"]')).toBeVisible();
  const right = await welcome(page)
    .locator('[data-hero-part="window-right"]')
    .boundingBox();
  const chips = await welcome(page)
    .locator('[data-hero-part="chip"]')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
  if (right === null) throw new Error('no right window');
  expect(chips).toHaveLength(3);
  expect(
    chips.every((left) => left >= right.x && left <= right.x + right.width)
  ).toBe(true);
  await welcome(page)
    .getByRole('button', { name: 'Get started', exact: true })
    .click();
  const full = await waitForFullView(context);
  await expect(hello(full)).toBeVisible();
  expect(await animationsIn(page)).toEqual([]);
  // Hello's own load had no emulation; reload it reduced, then not (the CONTROL), on the same page.
  await full.emulateMedia({ reducedMotion: 'reduce' });
  await full.reload();
  await expect(hello(full)).toBeVisible();
  expect(await animationsIn(full)).toEqual([]);
  await full.emulateMedia({ reducedMotion: 'no-preference' });
  await full.reload();
  await expect(hello(full)).toBeVisible();
  await expect
    .poll(async () => (await animationsIn(full)).map((a) => a.target))
    .toContain('hello');
});
