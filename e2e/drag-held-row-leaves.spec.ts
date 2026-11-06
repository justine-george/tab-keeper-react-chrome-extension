// KAN-393 on the real artifact. A keyboard switch of session mid-drag leaves the drag areas mounted with another
// session's rows, so a drag has to end when its held row leaves the list: unmounting never comes.

import { type Page } from '@playwright/test';
import {
  S2,
  carryTargets,
  detailPane,
  layout,
  openPopup,
  selected,
  session,
  sessionRow,
  setDetailScroll,
  tab,
  win,
} from './fixtures/betweenSessions';
import { boxOf, pickUp, tabHandle } from './fixtures/sessionDrag';
import { expect, grantedTest as test } from './fixtures/grantedExtension';

const S1_START = ['a0 a1 a2 al0* al1*', 'b0 b1'];
const S2_START = ['c0 c1 ga0* ga1* c2', 'e0 e1'];

const dragFlag = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-dragging'));

async function selectFromKeyboard(page: Page, id: string) {
  await sessionRow(page, id).locator('button').first().focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => selected(page)).toBe(id);
}

// The drag is over, with nothing left behind it.
async function expectNoDrag(page: Page) {
  await expect.poll(() => dragFlag(page)).toBeNull();
  await expect(page.locator('[data-drag-card]')).toHaveCount(0);
  await expect(page.locator('[data-carry-card]')).toHaveCount(0);
  await expect(page.locator('[data-drag-held]')).toHaveCount(0);
}

test.describe('a keyboard switch of session with a tab held', () => {
  test('the drag ends at the switch, cursor and card with it', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await page.mouse.move(at.x, at.y + 12, { steps: 3 });
    // PREMISE: a started drag.
    expect(await dragFlag(page)).toBe('tab');

    await selectFromKeyboard(page, 'S2');

    await expectNoDrag(page);
    expect(
      await page.evaluate(() => getComputedStyle(document.body).cursor)
    ).not.toBe('grabbing');
    await page.mouse.up();
    expect(await layout(page, 'S1')).toEqual(S1_START);
    expect(await layout(page, 'S2')).toEqual(S2_START);
  });

  test('the New window target is not offered after it, and a release there makes no window', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const aim = await boxOf(page.getByRole('button', { name: 'Open session' }));
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await page.mouse.move(at.x, at.y + 12, { steps: 3 });
    await selectFromKeyboard(page, 'S2');
    await expectNoDrag(page);

    await page.mouse.move(aim.x + aim.width / 2, aim.y + aim.height / 2, {
      steps: 8,
    });
    await expect(
      page.locator('[data-new-window-target="first"][data-landing]')
    ).toHaveCount(0);
    await page.mouse.up();

    expect(await layout(page, 'S1')).toEqual(S1_START);
    expect(await layout(page, 'S2')).toEqual(S2_START);
    expect(await selected(page)).toBe('S2');
  });

  test('moved on to the session list, it lights no row and carries nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await page.mouse.move(at.x, at.y + 12, { steps: 3 });
    await selectFromKeyboard(page, 'S2');
    await expectNoDrag(page);

    const third = await boxOf(sessionRow(page, 'S3'));
    await page.mouse.move(
      third.x + third.width / 2,
      third.y + third.height / 2,
      { steps: 6 }
    );
    // NEGATIVE, so a fixed wait: past the frames a carry would need to draw.
    await page.waitForTimeout(200);
    expect(await carryTargets(page)).toEqual([]);
    await expect(page.locator('[data-carry-card]')).toHaveCount(0);
    await page.mouse.up();
    // The press's own click opens nothing either.
    expect(await selected(page)).toBe('S2');
  });

  test('a press under the threshold starts no drag on the row that went', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const b = await boxOf(tabHandle(page, 'a1'));
    await page.mouse.move(b.x + 40, b.y + b.height / 2);
    await page.mouse.down();
    await selectFromKeyboard(page, 'S2');

    await page.mouse.move(b.x + 40, b.y + b.height / 2 + 30, { steps: 4 });

    await expectNoDrag(page);
    await page.mouse.up();
    expect(await layout(page, 'S2')).toEqual(S2_START);
  });

  test('from a scrolled session: the new session keeps its own scroll', async ({
    context,
    extensionId,
  }) => {
    const long = session(
      'L',
      'Long',
      Array.from({ length: 12 }, (_, i) =>
        win(`w${i}`, [tab(`t${i}a`), tab(`t${i}b`), tab(`t${i}c`)])
      )
    );
    const page = await openPopup(context, extensionId, [long, S2()], 'L');
    const grab = tabHandle(page, 't6b');
    await grab.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // PREMISE: the drag starts scrolled.
    expect((await detailPane(page)).scrollTop).toBeGreaterThan(0);
    const at = await pickUp(page, grab);
    await page.mouse.move(at.x, at.y + 6, { steps: 2 });

    await selectFromKeyboard(page, 'S2');
    await expectNoDrag(page);
    await setDetailScroll(page, 0);
    await page.mouse.up();

    expect((await detailPane(page)).scrollTop).toBe(0);
    expect(await layout(page, 'S2')).toEqual(S2_START);
  });
});
