import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-76. Every assertion here reads the cursor from the element that is
// really under the pointer, via elementFromPoint, rather than from the control
// the test names.
//
// That is the whole defect. Icon painted `cursor: default` on itself whenever
// it did not own its own onClick, and an Icon that does not own its onClick is
// usually sitting inside something that does -- a Button or a ClickableRow,
// both of which render a real <button> carrying `cursor: pointer`. The child
// won, so the button advertised a pointer it never showed.
//
// A child overriding its parent is invisible to `toHaveCSS` on the button
// (which reports the button's own declaration, still `pointer`, still passing)
// and invisible to jsdom, which does not resolve inheritance for `cursor` at
// all. Sampling the hit target is the only probe that can see it.

const RESEARCH = buildSession({
  tabGroupId: 'session-research',
  title: 'Research',
});

async function openPopup(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context, buildContainer([RESEARCH]));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}

/** The cursor the browser would actually paint at a viewport point. */
async function cursorAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el === null
        ? '<nothing under the pointer>'
        : getComputedStyle(el).cursor;
    },
    [x, y]
  );
}

async function cursorAtCentreOf(page: Page, target: Locator): Promise<string> {
  const box = await target.boundingBox();
  if (box === null) throw new Error('the target has no layout box');
  return cursorAt(page, box.x + box.width / 2, box.y + box.height / 2);
}

// Material Symbols renders its glyph as ligature TEXT, so the icon inside a
// control is the span whose text content is the glyph name.
function glyphOf(control: Locator): Locator {
  return control.locator('span.material-symbols-outlined').first();
}

// Probes the glyph specifically, not the control's centre. On an icon-only
// button the two coincide, but on an icon+text button the centre lands on the
// text -- which was never broken -- so a centre probe would pass against the
// defect. "Backup App Data to File" below is the case that proves this matters.
async function cursorOverIconOf(page: Page, control: Locator): Promise<string> {
  return cursorAtCentreOf(page, glyphOf(control));
}

async function openSettingsCategory(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Themes')).toBeVisible();
  await page.getByRole('button', { name, exact: true }).click();
}

test.describe('clickable controls show a pointer over their icon (KAN-76)', () => {
  // CONTROL, positive. An Icon that owns its own onClick was never affected,
  // and reads `pointer` today. If this fails, the probe is broken rather than
  // the app: it is the proof that cursorOverIconOf can observe a pointer at
  // all, without which every assertion below is unfalsifiable.
  test('CONTROL: an Icon that owns its onClick already shows a pointer', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);

    const settings = page.getByRole('button', { name: 'Settings' });
    expect(await cursorOverIconOf(page, settings)).toBe('pointer');
  });

  // CONTROL, negative. The other half: proof that the probe can return
  // something OTHER than `pointer`, so a `pointer` result elsewhere is a
  // measurement and not a constant.
  //
  // It is also the regression this fix must not cause. Undo is genuinely
  // unavailable on a freshly opened popup -- there is no history to undo --
  // and a control that is unavailable must not advertise a click. Deferring to
  // the ancestor is only correct if it keeps saying "not clickable" here,
  // where the ancestor is a plain layout div.
  test('CONTROL: a disabled Icon does not show a pointer', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);

    const undo = page.getByRole('button', { name: 'Undo' });
    // Asserted, not assumed. If Undo were enabled at this moment the cursor
    // assertion below would be testing the wrong state and would pass for the
    // wrong reason.
    await expect(undo).toHaveAttribute('aria-disabled', 'true');

    expect(await cursorOverIconOf(page, undo)).not.toBe('pointer');

    // The value this actually resolves to is `auto`, not the `default` it was
    // before, because the ancestor here is a plain layout div. The two paint
    // the same arrow only because the glyph is not selectable -- `auto` over
    // selectable text is an I-beam. That premise is the reason the change is
    // safe, so it is asserted rather than reasoned about.
    await expect(glyphOf(undo)).toHaveCSS('user-select', 'none');
  });

  // Pattern 1: Button always passes `disable={true}` to its inner Icon, so
  // every one of the icon-bearing buttons in the app was affected. These two
  // are the worst case -- `padding: 0` means the icon fills the button, so
  // there was no live pixel anywhere on the control.
  //
  // These are the RENDERED names, not the i18n keys the call sites pass.
  // `en` re-maps some of its own keys, and this pair is one of them:
  // UserInputContainer passes `t('Save every open window as a session')`,
  // which en/translation.json:11 maps to "Save all open windows as a session".
  // Written from the key, this locator matches nothing and the test fails as
  // "element(s) not found" -- which looks like a broken control rather than a
  // broken locator. src/tests/locales/verbSplit.test.ts guards the mapping
  // itself; this comment is here so the next person does not re-derive it from
  // a confusing failure.
  for (const name of [
    'Save current window as a session',
    'Save all open windows as a session',
  ]) {
    test(`"${name}" shows a pointer over its icon`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      const button = page.getByRole('button', { name });

      // The button's own declaration was never the problem, and stating that
      // here is what makes the failure legible: the two lines disagreeing is
      // precisely the bug.
      await expect(button).toHaveCSS('cursor', 'pointer');
      expect(await cursorOverIconOf(page, button)).toBe('pointer');
    });
  }

  // Pattern 2: a bare <Icon> with no onClick at all, inside a ClickableRow.
  // Unrelated to `disable`, same single line of CSS. This is the one the
  // ticket's first scope missed.
  test('the settings back row shows a pointer over its icon', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Themes')).toBeVisible();

    const back = page.getByRole('button', { name: 'Go back' });
    await expect(back).toHaveCSS('cursor', 'pointer');
    expect(await cursorOverIconOf(page, back)).toBe('pointer');
  });

  // The icon+text geometry, which is where the defect was most obviously
  // wrong to a user: the cursor changed as the pointer crossed a single
  // button. The text half is asserted alongside the icon half precisely
  // because the text half always passed -- it is what the icon half should
  // have matched all along, and probing only the centre would have found
  // nothing to report.
  test('an icon+text button shows a pointer over BOTH halves', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await openSettingsCategory(page, 'Data Management');

    const button = page.getByRole('button', {
      name: 'Backup App Data to File',
    });
    const label = button.getByText('Backup App Data to File');

    expect(await cursorAtCentreOf(page, label)).toBe('pointer');
    expect(await cursorOverIconOf(page, button)).toBe('pointer');
  });

  // The other half of the fix, which the ticket asked to be verified rather
  // than assumed: an icon that is genuinely decorative, in a container nobody
  // can click, must NOT start advertising a click.
  //
  // `cloud_done` sits in a plain layout div in Account/LoggedIn. Deferring to
  // the ancestor is only the right answer if the ancestor's answer is right
  // here too -- if this ever reads `pointer`, `inherit` is reaching a
  // clickable ancestor that this icon has no business inheriting from.
  test('a decorative icon in a non-clickable container shows no pointer', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await openSettingsCategory(page, 'Sync & Privacy');

    // Which of the two Account panes renders is asserted, not assumed: the
    // fixture context is signed IN, so this is LoggedIn/`cloud_done`, and the
    // sibling NotLoggedIn/`cloud_off` is unreachable here. Without this line a
    // wrong glyph name would surface as an unexplained locator timeout.
    await expect(page.getByText('Cloud Sync Active')).toBeVisible();
    const decorative = page
      .locator('span.material-symbols-outlined')
      .filter({ hasText: /^cloud_done$/ });

    expect(await cursorAtCentreOf(page, decorative)).not.toBe('pointer');
  });
});
