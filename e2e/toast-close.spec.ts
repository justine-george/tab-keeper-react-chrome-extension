import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP } from './fixtures/savedWindows';
import { sessionHeaderMenu } from './fixtures/menus';

// KAN-980 (pick A2) on the real artifact: each toast has a 24px circle × over
// its top-right corner, shown only while that toast is hovered or has focus
// in it. A press closes that toast only, so clicks in one spot clear a stack
// newest first. From the keyboard, Enter or Escape closes the focused toast
// and focus goes to the next front toast's ×. A claimed Escape is what keeps
// Chrome's popup open (KAN-426), so each Escape here is checked for it.

const SESSIONS = ['Alpha', 'Bravo', 'Charlie'].map((t) =>
  buildSession({ tabGroupId: `s-${t.toLowerCase()}`, title: t })
);
const AWAY = { x: 700, y: 60 };
const DELETED = 'Session deleted.';
// The badge's size, and how far it reaches past the toast's outer top and
// right edges: 11px from inside its 1px border, as mocked.
const BADGE_PX = 24;
const OVERHANG_PX = 10;

async function openPopup(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer(SESSIONS),
    selectedTabGroupId: 's-alpha',
  });
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // Barrier: goto resolves before React mounts. Locale-free.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

// The toasts on screen, oldest first; a leaving one is aria-hidden.
const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');
const closeOf = (toast: Locator): Locator =>
  toast.getByRole('button', { name: 'Close', exact: true });
const message = (toast: Locator): Locator => toast.locator(':scope > span');
const sessionRow = (page: Page, title: string): Locator =>
  page
    .locator('[data-pane="sessions"]')
    .getByRole('button', { name: title, exact: true });

// Deletes a session with ⌫ on its row, the pointer kept off the stack.
async function deleteSession(page: Page, title: string): Promise<void> {
  await sessionRow(page, title).focus();
  await page.keyboard.press('Backspace');
  await page.mouse.move(AWAY.x, AWAY.y);
}

async function copyAllLinks(page: Page): Promise<void> {
  await sessionHeaderMenu(page).click();
  await page.getByRole('menuitem', { name: 'Copy all links' }).click();
  await page.mouse.move(AWAY.x, AWAY.y);
}

// Copied links (oldest), then Alpha's and Bravo's deletes (newest, with Undo).
async function threeToasts(page: Page): Promise<void> {
  await copyAllLinks(page);
  await deleteSession(page, 'Alpha');
  await deleteSession(page, 'Bravo');
  await expect(toasts(page)).toHaveCount(3);
}

// Whether a × can be seen: its slot drawn opaque.
const shows = (close: Locator): Promise<boolean> =>
  close.evaluate((el) => {
    const slot = el.closest('[data-toast-close]');
    if (!slot) throw new Error('no close slot');
    return getComputedStyle(slot).opacity === '1';
  });

// Every transition in the stack has finished.
async function settled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .querySelector('[role="status"]')
            ?.getAnimations({ subtree: true }).length ?? -1
      )
    )
    .toBe(0);
}

// Presses a key and reports whether the page claimed it, read once every
// listener has run.
async function pressAndReadClaim(page: Page, key: string): Promise<boolean> {
  await page.evaluate(() => {
    const w = window as unknown as { lastKeyClaimed: boolean | null };
    w.lastKeyClaimed = null;
    window.addEventListener(
      'keydown',
      (e) => {
        w.lastKeyClaimed = e.defaultPrevented;
      },
      { once: true }
    );
  });
  await page.keyboard.press(key);
  return page.evaluate(
    () =>
      (window as unknown as { lastKeyClaimed: boolean | null })
        .lastKeyClaimed === true
  );
}

const focusedIsCloseOf = (toast: Locator): Promise<boolean> =>
  closeOf(toast).evaluate((el) => document.activeElement === el);

test('the × shows over the hovered toast’s top-right corner, on that toast only', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await threeToasts(page);
  const front = toasts(page).nth(2);
  const oldest = toasts(page).nth(0);
  await settled(page);

  // Nothing hovered: no × shows.
  for (let i = 0; i < 3; i += 1) {
    expect(await shows(closeOf(toasts(page).nth(i)))).toBe(false);
  }

  // The front toast hovered: its × only.
  await message(front).hover();
  await settled(page);
  expect(await shows(closeOf(front))).toBe(true);
  expect(await shows(closeOf(toasts(page).nth(1)))).toBe(false);
  expect(await shows(closeOf(oldest))).toBe(false);

  const toastBox = await front.boundingBox();
  const badgeBox = await closeOf(front).boundingBox();
  if (!toastBox || !badgeBox) throw new Error('no box');
  expect(badgeBox.width).toBe(BADGE_PX);
  expect(badgeBox.height).toBe(BADGE_PX);
  expect(badgeBox.x + badgeBox.width - (toastBox.x + toastBox.width)).toBe(
    OVERHANG_PX
  );
  expect(toastBox.y - badgeBox.y).toBe(OVERHANG_PX);

  // In the toast's own fill and border, a circle.
  const [toastLook, badgeLook] = await Promise.all(
    [front, closeOf(front)].map((l) =>
      l.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          fill: s.backgroundColor,
          border: `${s.borderTopWidth} ${s.borderTopColor}`,
          shape: `${s.borderTopRightRadius} ${s.getPropertyValue('corner-shape')}`,
        };
      })
    )
  );
  expect(badgeLook.fill).toBe(toastLook.fill);
  expect(badgeLook.border).toBe(toastLook.border);
  // Chrome reads `round` back as superellipse(1).
  expect(badgeLook.shape).toBe('50% superellipse(1)');

  // The oldest hovered in the opened stack: its × shows, the front's goes.
  await message(oldest).hover();
  await settled(page);
  expect(await shows(closeOf(oldest))).toBe(true);
  expect(await shows(closeOf(front))).toBe(false);

  // The pointer away: none again.
  await page.mouse.move(AWAY.x, AWAY.y);
  await settled(page);
  expect(await shows(closeOf(oldest))).toBe(false);
});

test('clicks in one spot clear the stack newest first; closing Undo’s toast undoes nothing', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await threeToasts(page);
  const front = toasts(page).nth(2);
  await message(front).hover();
  await settled(page);
  const box = await closeOf(front).boundingBox();
  if (!box) throw new Error('no box');
  const spot = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.click(spot.x, spot.y);
  await expect(toasts(page)).toHaveCount(2);
  await expect(message(toasts(page).nth(1))).toHaveText(DELETED);
  // Bravo stays deleted: the × closed its toast, not its change.
  await expect(sessionRow(page, 'Bravo')).toHaveCount(0);
  await settled(page);

  await page.mouse.click(spot.x, spot.y);
  await expect(toasts(page)).toHaveCount(1);
  await expect(message(toasts(page).first())).not.toHaveText(DELETED);
  await settled(page);

  await page.mouse.click(spot.x, spot.y);
  await expect(toasts(page)).toHaveCount(0);

  // The step is still there to undo with the key.
  await page.mouse.move(AWAY.x, AWAY.y);
  await page.keyboard.press('Control+z');
  await expect(sessionRow(page, 'Bravo')).toHaveCount(1);
});

// Spots on the × relative to its centre: inside the toast, and in the parts
// that overhang its right and top edges, where nothing else takes the pointer.
const SPOTS = [
  { name: 'its centre', dx: 0, dy: 0 },
  { name: 'past the right edge', dx: 8, dy: 0 },
  { name: 'above the top edge', dx: 0, dy: -8 },
  { name: 'its outer corner', dx: 6, dy: -6 },
];
for (const { name, dx, dy } of SPOTS) {
  test(`clicks on ${name} keep the stack open, the next × under the pointer`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await threeToasts(page);
    await message(toasts(page).nth(2)).hover();
    await settled(page);
    const box = await closeOf(toasts(page).nth(2)).boundingBox();
    if (!box) throw new Error('no box');
    const spot = {
      x: box.x + box.width / 2 + dx,
      y: box.y + box.height / 2 + dy,
    };
    await page.mouse.move(spot.x, spot.y);

    for (const left of [2, 1]) {
      await page.mouse.click(spot.x, spot.y);
      await expect(toasts(page)).toHaveCount(left);
      await settled(page);
      await expect(page.getByRole('status')).toHaveAttribute(
        'data-stack',
        'open'
      );
      const front = toasts(page).nth(left - 1);
      expect(await shows(closeOf(front))).toBe(true);
      // The pointer is on the next ×, so the next click lands on it.
      expect(
        await closeOf(front).evaluate(
          (el, p) => el.contains(document.elementFromPoint(p.x, p.y)),
          spot
        )
      ).toBe(true);
    }
    await page.mouse.click(spot.x, spot.y);
    await expect(toasts(page)).toHaveCount(0);
  });
}

test('from the keyboard: Enter, then Escape, each close the front toast and hand focus on', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await threeToasts(page);
  await settled(page);

  // Reachable while hidden: focus is what shows it.
  const front = toasts(page).nth(2);
  expect(await shows(closeOf(front))).toBe(false);
  await closeOf(front).focus();
  await settled(page);
  expect(await shows(closeOf(front))).toBe(true);

  await page.keyboard.press('Enter');
  await expect(toasts(page)).toHaveCount(2);
  const next = toasts(page).nth(1);
  expect(await focusedIsCloseOf(next)).toBe(true);
  await settled(page);
  expect(await shows(closeOf(next))).toBe(true);

  expect(await pressAndReadClaim(page, 'Escape')).toBe(true);
  await expect(toasts(page)).toHaveCount(1);
  expect(await focusedIsCloseOf(toasts(page).first())).toBe(true);

  expect(await pressAndReadClaim(page, 'Escape')).toBe(true);
  await expect(toasts(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => document.activeElement === document.body)
  ).toBe(true);
});

test('Escape on the Undo chip closes its toast and undoes nothing', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await deleteSession(page, 'Alpha');
  await expect(toasts(page)).toHaveCount(1);
  await toasts(page).first().getByRole('button', { name: /^Undo/ }).focus();

  expect(await pressAndReadClaim(page, 'Escape')).toBe(true);
  await expect(toasts(page)).toHaveCount(0);
  await expect(sessionRow(page, 'Alpha')).toHaveCount(0);
});

test('Escape with focus outside the stack is left alone and closes no toast', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await deleteSession(page, 'Alpha');
  await expect(toasts(page)).toHaveCount(1);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });

  // Unclaimed, so in the toolbar popup Chrome closes the popup, as before.
  expect(await pressAndReadClaim(page, 'Escape')).toBe(false);
  await expect(toasts(page)).toHaveCount(1);
});
