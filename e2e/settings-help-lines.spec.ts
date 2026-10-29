import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';
import { localeStrings } from './fixtures/locales';

// KAN-860. Auto sync, Backup, Cloud data and Save tab groups each get a help
// line under their controls, which those controls are described by. The
// wording is the component tests'; this pins the wiring and the fit in the
// popup, in the longest languages, at Chrome's Large text size too.

const AUTO_SYNC =
  'Syncs your sessions across your Chrome devices. Settings stay separate on each device.';
const BACKUP =
  'Saves your sessions to a file. Settings aren’t included. Loading a backup asks whether to merge it with your sessions or replace them.';
const CLOUD_DATA =
  'Removes your sessions from the cloud and turns Auto sync off. Your sessions stay on this device and on your other devices.';
const SAVE_TAB_GROUPS =
  'Saved sessions keep each tab group’s name and colour, and the groups come back when you reopen the session.';

async function openPane(
  page: Page,
  extensionId: string,
  strings: Record<string, string>,
  pane: string,
  root: number
) {
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page
    .getByRole('button', { name: strings.Settings, exact: true })
    .click();
  await page.getByRole('button', { name: strings[pane], exact: true }).click();
  await page.evaluate((px) => {
    document.documentElement.style.fontSize = `${px}px`;
  }, root);
}

// The line is the control's description, sits under it in the same section,
// and nothing in that section is cut off sideways.
async function expectHelpLine(control: Locator, text: string) {
  await expect(control).toHaveAccessibleDescription(text);
  const line = control.page().getByText(text, { exact: true });
  await expect(line).toBeVisible();
  const fit = await line.evaluate(
    (p, controlEl) => {
      const section = p.closest('[data-settings-section]');
      if (!section) throw new Error('a help line outside any section');
      const c = controlEl.getBoundingClientRect();
      const l = p.getBoundingClientRect();
      const s = section.getBoundingClientRect();
      return {
        sameSection: section.contains(controlEl),
        below: l.top >= c.bottom,
        inside: l.right <= s.right + 0.5,
        overflow: section.scrollWidth - section.clientWidth,
      };
    },
    await control.elementHandle()
  );
  expect(fit).toEqual({
    sameSection: true,
    below: true,
    inside: true,
    overflow: 0,
  });
}

for (const language of ['en', 'de', 'ru'])
  for (const root of [16, 20])
    test(`KAN-860: the help lines describe their controls and fit (${language}, ${root}px root)`, async ({
      context,
      extensionId,
    }) => {
      const strings = localeStrings(language);
      // The help lines' keys are their English text.
      const say = (key: string) => strings[key];
      await seedSettings(context, { language });
      const page = await context.newPage();

      await openPane(page, extensionId, strings, 'Sync & Backup', root);
      await expectHelpLine(
        page.getByRole('group', { name: strings['Auto Sync'] }),
        say(AUTO_SYNC)
      );
      for (const button of [
        'Save sessions to a file',
        'Load sessions from a backup',
      ])
        await expectHelpLine(
          page.getByRole('button', { name: strings[button], exact: true }),
          say(BACKUP)
        );
      await expectHelpLine(
        page.getByRole('button', {
          name: strings['Delete cloud data'],
          exact: true,
        }),
        say(CLOUD_DATA)
      );

      await page
        .getByRole('button', { name: strings.Sessions, exact: true })
        .click();
      await expectHelpLine(
        page.getByRole('group', { name: strings['Save Tab Groups'] }),
        say(SAVE_TAB_GROUPS)
      );
    });
