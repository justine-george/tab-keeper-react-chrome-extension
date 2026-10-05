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
