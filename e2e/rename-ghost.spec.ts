import type { Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import { openPage } from './fixtures/onboarding';
import {
  bandHandle,
  groupedWindow,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';
import { standIn } from './fixtures/standInPages';
import { CHALK_THEME } from '../src/hooks/useThemeColors';
import { channels } from './fixtures/pixels';

// KAN-631. A title that renames on click shows, under the pointer or keyboard
// focus, a ghost of the field the click opens: its fill 65% of the way from the
// ground to the field's own, and a soft edge. Read from the real ::before.

type Ghost = { fill: number[]; edge: number[]; textBox: string };

// The field's fill (PRIMARY) 65% over the ground the title sits on.
const ghostFill = (ground: string) => {
  const [f, g] = [channels(CHALK_THEME.PRIMARY_COLOR), channels(ground)];
  return f.map((c, i) => 0.65 * c + 0.35 * g[i]).concat(255);
};

// Any computed colour (rgb, color(srgb ...), oklab mid-transition) as [r, g, b, a], all 0..255, via a 1px canvas.
async function ghostOf(button: Locator, text: Locator): Promise<Ghost> {
  const textBox = JSON.stringify(await text.boundingBox());
  return button.evaluate((el, textBox) => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    const parse = (c: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const before = getComputedStyle(el, '::before');
    return {
      fill: parse(before.backgroundColor),
      edge: parse(before.borderTopColor),
      textBox,
    };
  }, textBox);
}

const near = (a: number[], b: number[]) =>
  a.length >= b.length && b.every((v, i) => Math.abs(a[i] - v) <= 1);

// At rest nothing shows; on hover the ghost lands, and the title's text does not move.
async function expectGhostOnHover(
  page: Page,
  button: Locator,
  text: Locator,
  ground: string
) {
  await page.mouse.move(0, 0);
  const rest = await ghostOf(button, text);
  expect(rest.fill[3]).toBe(0);
  expect(rest.edge[3]).toBe(0);

  await text.hover();
  await expect
    .poll(async () => {
      const g = await ghostOf(button, text);
      return (
        near(g.fill, ghostFill(ground)) &&
        near(g.edge, channels(CHALK_THEME.ICON_HOVER_COLOR).concat(255))
      );
    })
    .toBe(true);
  expect((await ghostOf(button, text)).textBox).toBe(rest.textBox);
}

test.describe('a click-to-rename title shows a ghost of its field (KAN-631)', () => {
  const S1 = session('S1', 'Research', [
    savedWindow('w1', 'Reading list', 1, { width: 800, height: 600 }),
    savedWindow('w2', '', 1, { width: 800, height: 600 }),
  ]);

  test('the session title, on the header ground', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S1],
    });
    const button = page.getByRole('button', {
      name: 'Rename session: Research',
      exact: true,
    });
    await expect(button).toBeVisible();
    await expectGhostOnHover(
      page,
      button,
      button.getByText('Research', { exact: true }),
      CHALK_THEME.SECONDARY_COLOR
    );
  });

  for (const [id, label] of [
    ['w1', 'Reading list'],
    ['w2', 'Window 2'],
  ]) {
    test(`the window title "${label}", on the hovered row`, async ({
      context,
      extensionId,
    }) => {
      const page = await openSaved(context, extensionId, 'popup', {
        sessions: [S1],
      });
      const button = page
        .locator(
          `[data-pane="detail"] [data-drag-row-id="${id}"] [data-window-drag-handle]`
        )
        .getByRole('button', { name: `Rename window: ${label}`, exact: true });
      await expect(button).toBeVisible();
      await expectGhostOnHover(
        page,
        button,
        button.getByText(label, { exact: true }),
        CHALK_THEME.HOVER_COLOR
      );
    });
  }

  test('keyboard focus shows it too', async ({ context, extensionId }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S1],
    });
    const button = page.getByRole('button', {
      name: 'Rename session: Research',
      exact: true,
    });
    await expect(button).toBeVisible();
    await page.mouse.move(0, 0);
    // By Tab: a scripted focus is not keyboard navigation (KAN-689).
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    expect(await button.evaluate((el) => el.matches(':focus-visible'))).toBe(
      true
    );
    await expect
      .poll(async () =>
        near(
          (await ghostOf(button, button)).fill,
          ghostFill(CHALK_THEME.SECONDARY_COLOR)
        )
      )
      .toBe(true);
  });

  // CONTROL. The rename field itself is unchanged: PRIMARY fill, control edge.
  test('CONTROL: the click opens the same field as before', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S1],
    });
    await page
      .getByRole('button', { name: 'Rename session: Research', exact: true })
      .click();
    const field = page.locator('input[data-tour-anchor="title"]');
    await expect(field).toBeFocused();
    const rgb = (hex: string) => `rgb(${channels(hex).join(', ')})`;
    await expect(field).toHaveCSS(
      'background-color',
      rgb(CHALK_THEME.PRIMARY_COLOR)
    );
    await expect(field).toHaveCSS(
      'border-top-color',
      rgb(CHALK_THEME.CONTROL_BORDER_COLOR)
    );
  });
});

grantedTest.describe(
  'a group title shows a ghost of its field (KAN-631)',
  () => {
    const GROUPED = session('S1', 'Grouped', [
      groupedWindow('gw', 'Grouped', [
        { groupId: 'gr', title: 'Research', color: 'blue' },
      ]),
    ]);

    grantedTest(
      'the saved band title, on the hovered band',
      async ({ context, extensionId }) => {
        const page = await openSaved(context, extensionId, 'popup', {
          sessions: [GROUPED],
        });
        const button = bandHandle(page, 'gr').getByRole('button', {
          name: 'Rename group: Research',
          exact: true,
        });
        await expect(button).toBeVisible();
        await expectGhostOnHover(
          page,
          button,
          button.getByText('Research', { exact: true }),
          CHALK_THEME.HOVER_COLOR
        );
      }
    );

    async function openKyoto(worker: Worker) {
      return worker.evaluate(async (urls) => {
        const win = await chrome.windows.create({ url: urls, focused: false });
        const [first, second] = (win?.tabs ?? []).map((tab) => tab.id ?? -1);
        const groupId = await chrome.tabs.group({
          tabIds: [first, second],
          createProperties: { windowId: win?.id },
        });
        await chrome.tabGroups.update(groupId, {
          title: 'Kyoto',
          color: 'blue',
        });
        return win?.id ?? -1;
      }, ['Temples', 'Gardens'].map(standIn));
    }

    grantedTest(
      'the Open now group title, on the hovered row',
      async ({ context, extensionId, serviceWorker }) => {
        const page = await openPage(
          context,
          extensionId,
          'index.html?view=tab',
          { width: 1280, height: 800 }
        );
        const windowId = await openKyoto(serviceWorker);
        const button = page
          .locator(`[data-open-window-id="${windowId}"]`)
          .getByRole('button', { name: 'Rename group: Kyoto', exact: true });
        await expect(button).toBeVisible();
        await expectGhostOnHover(
          page,
          button,
          button.getByText('Kyoto', { exact: true }),
          CHALK_THEME.HOVER_COLOR
        );
      }
    );
  }
);
