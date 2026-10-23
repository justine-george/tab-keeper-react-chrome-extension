import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { putDeviceId } from './fixtures/cloud';
import { FULL_VIEW_PATH, POPUP } from './fixtures/onboarding';
import { localeStrings } from './fixtures/locales';
import { rgbToHex } from './fixtures/pixels';
import { CHALK_THEME } from '../src/hooks/useThemeColors';

// KAN-748. Switch, Delete cloud data and Empty close like the tab groups offer
// (KAN-732): the way out, then the primary half as wide again, paired at the
// right, 48px. Load backup has Cancel as a flush link on the left, then quiet
// Replace and a filled Merge, the widest: Merge is the safe answer.

type Dialog = 'switch' | 'delete' | 'empty' | 'load';

const t = (lang: string, key: string) => localeStrings(lang)[key];

// Each opener reads its labels from the locale, so the same steps run in every language.
async function openDialog(
  context: BrowserContext,
  serviceWorker: Worker,
  extensionId: string,
  which: Dialog,
  language = 'en'
): Promise<Page> {
  await seedSettings(context, {
    theme: 'Chalk',
    language,
    ...(which === 'delete'
      ? { cloudConsent: 'declined', isAutoSync: false }
      : {}),
  });
  if (which === 'delete') await putDeviceId(serviceWorker);
  await seedSessions(
    context,
    buildContainer(
      ['Alpha', 'Bravo', 'Charlie'].map((title) =>
        buildSession({ tabGroupId: title, title })
      )
    )
  );
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(
    `chrome-extension://${extensionId}/${which === 'load' ? FULL_VIEW_PATH : 'index.html'}`
  );
  await page.locator('[data-tour-anchor="save"]').waitFor();
  const sessions = page.locator('[data-pane="sessions"]');
  const settingsPane = async (row: string) => {
    await page.locator(`[aria-label="${t(language, 'Settings')}"]`).click();
    await page.locator(`button[aria-label="${t(language, row)}"]`).click();
  };

  if (which === 'switch') {
    await sessions
      .getByRole('button', { name: t(language, 'Switch'), exact: true })
      .click();
  } else if (which === 'delete') {
    await settingsPane('Sync & Backup');
    await page
      .getByRole('button', { name: t(language, 'Delete cloud data') })
      .click();
  } else if (which === 'empty') {
    for (const title of ['Bravo', 'Charlie']) {
      const row = sessions.getByRole('button', { name: title, exact: true });
      await row.focus();
      await page.keyboard.press('Delete');
      await expect(row).toHaveCount(0);
    }
    await settingsPane('Recently deleted');
    await page
      .getByRole('button', {
        name: t(language, 'EmptyRecentlyDeleted'),
        exact: true,
      })
      .click();
  } else {
    await settingsPane('Sync & Backup');
    const chooser = page.waitForEvent('filechooser');
    await page
      .getByRole('button', { name: t(language, 'Load sessions from a backup') })
      .click();
    await (
      await chooser
    ).setFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify(
          buildContainer([
            buildSession({ tabGroupId: 'f1', title: 'From file' }),
          ])
        )
      ),
    });
  }
  await expect(page.locator('dialog[open]')).toBeVisible();
  return page;
}

// The open dialog's content box and its buttons in DOM order.
function measure(page: Page) {
  return page.locator('dialog[open]').evaluate((d) => {
    const cs = getComputedStyle(d);
    const box = d.getBoundingClientRect();
    const left =
      box.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    const right =
      box.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const lines = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top)))
        .size;
    };
    const textLeft = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().left;
    };
    return {
      left,
      right,
      focusedIsDialog: document.activeElement === d,
      buttons: [...d.querySelectorAll('button')].map((b) => {
        const r = b.getBoundingClientRect();
        const s = getComputedStyle(b);
        return {
          text: b.textContent ?? '',
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
          mid: r.top + r.height / 2,
          textLeft: textLeft(b),
          background: s.backgroundColor,
          borderWidth: s.borderTopWidth,
          borderColor: s.borderTopColor,
          underline: s.textDecorationLine,
          clipped: b.scrollWidth > b.clientWidth,
          wrapped: lines(b) > 1,
        };
      }),
    };
  });
}

type Measured = Awaited<ReturnType<typeof measure>>;
type Button = Measured['buttons'][number];

function expectPairAtRight(m: Measured, secondary: Button, primary: Button) {
  expect(secondary.height).toBe(48);
  expect(primary.height).toBe(48);
  expect(Math.abs(secondary.mid - primary.mid)).toBeLessThan(2);
  expect(secondary.right).toBeLessThanOrEqual(primary.left);
  // Half as wide again, and flush with the content's right edge.
  expect(Math.abs(primary.width - 1.5 * secondary.width)).toBeLessThanOrEqual(
    1
  );
  expect(Math.abs(m.right - primary.right)).toBeLessThanOrEqual(0.5);
}

const outlined = (b: Button) => {
  expect(b.underline).toBe('none');
  expect(b.borderWidth).toBe('1px');
  expect(b.background).toBe('rgba(0, 0, 0, 0)');
};

for (const [which, primaryLabel, fill, fillName] of [
  ['switch', 'Switch', CHALK_THEME.TEXT_COLOR, 'filled'],
  ['delete', 'Delete', CHALK_THEME.DANGER_FILL, 'red'],
  ['empty', 'Delete', CHALK_THEME.DANGER_FILL, 'red'],
] as const) {
  test(`${which}: outlined Cancel then a ${fillName} ${primaryLabel} half as wide again, paired at the right, 48px`, async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const page = await openDialog(context, serviceWorker, extensionId, which);
    const m = await measure(page);
    expect(m.buttons.map((b) => b.text)).toEqual(['Cancel', primaryLabel]);
    const [cancel, primary] = m.buttons;
    expectPairAtRight(m, cancel, primary);
    outlined(cancel);
    expect(rgbToHex(primary.background)).toBe(fill.toUpperCase());
  });
}

test('load: Cancel is a flush link at the left, then quiet Replace and a filled Merge, the widest', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await openDialog(context, serviceWorker, extensionId, 'load');
  const m = await measure(page);
  expect(m.buttons.map((b) => b.text)).toEqual(['Cancel', 'Replace', 'Merge']);
  const [cancel, replace, merge] = m.buttons;
  expectPairAtRight(m, replace, merge);
  outlined(replace);
  expect(rgbToHex(merge.background)).toBe(CHALK_THEME.TEXT_COLOR.toUpperCase());
  // A link, its words on the content's left edge, on the pair's row.
  expect(cancel.underline).toBe('underline');
  expect(cancel.background).toBe('rgba(0, 0, 0, 0)');
  expect(Math.abs(cancel.textLeft - m.left)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(cancel.mid - merge.mid)).toBeLessThan(2);
  expect(cancel.right).toBeLessThan(replace.left);
  // Nothing is preselected: Enter must not answer for the user.
  expect(m.focusedIsDialog).toBe(true);
});

// Past Chrome's Very large (a custom font size), the row can't hold all three.
test('load: too narrow for one row, Cancel drops below the pair and no label wraps', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await openDialog(
    context,
    serviceWorker,
    extensionId,
    'load',
    'es'
  );
  await page.evaluate(() => (document.documentElement.style.fontSize = '30px'));
  const m = await measure(page);
  const [cancel, replace, merge] = m.buttons;
  for (const b of m.buttons) {
    expect(b.clipped, b.text).toBe(false);
    expect(b.wrapped, b.text).toBe(false);
  }
  expectPairAtRight(m, replace, merge);
  expect(cancel.mid).toBeGreaterThan(merge.mid + merge.height / 2);
  expect(Math.abs(cancel.textLeft - m.left)).toBeLessThanOrEqual(0.5);
});

// Chrome's Medium, Large and Very large: one row, nothing clipped or wrapped.
const ALL_LANGS = [
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'sv',
  'zh',
  'zh-TW',
] as const;
// Each PR: the longest Latin strings (fr, de) and one locale per other script.
const PR_LANGS = ['de', 'fr', 'ru', 'hi', 'ja'] as const;
const LANGS = process.env.E2E_ALL_LANGS === '1' ? ALL_LANGS : PR_LANGS;

for (const which of ['switch', 'delete', 'empty', 'load'] as const) {
  test(`${which}: the footer is one row in every language at 16, 20 and 24px`, async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    test.setTimeout(240_000);
    const slack: Record<string, number> = {};
    for (const lang of LANGS) {
      const page = await openDialog(
        context,
        serviceWorker,
        extensionId,
        which,
        lang
      );
      for (const px of [16, 20, 24]) {
        const at = `${lang} at ${px}px`;
        await page.evaluate(
          (p) => (document.documentElement.style.fontSize = `${p}px`),
          px
        );
        const m = await measure(page);
        const first = m.buttons[0];
        const last = m.buttons[m.buttons.length - 1];
        for (const b of m.buttons) {
          expect(Math.abs(b.mid - last.mid), `${at} ${b.text}`).toBeLessThan(2);
          expect(b.clipped, `${at} ${b.text}`).toBe(false);
          expect(b.wrapped, `${at} ${b.text}`).toBe(false);
        }
        expect(last.right - m.right, at).toBeLessThanOrEqual(0.5);
        // Room left: before the pair, or between Load backup's link and its pair (12px gap).
        slack[at] = Math.round(
          which === 'load'
            ? m.buttons[1].left - first.right - 12
            : first.left - m.left
        );
      }
      await page.close();
    }
    const [tightest, px] = Object.entries(slack).sort((x, y) => x[1] - y[1])[0];
    console.log(`${which} tightest: ${tightest}, ${px}px to spare`);
    expect(px).toBeGreaterThanOrEqual(0);
  });
}
