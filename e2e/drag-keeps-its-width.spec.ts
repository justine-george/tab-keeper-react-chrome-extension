// KAN-368. A held row's transform extends the list's scrollable overflow: a list that fits must not grow a scrollbar mid-drag.
import { type Page } from '@playwright/test';
import { openPopup, session, win, tab, S3 } from './fixtures/betweenSessions';
import { pickUp, tabHandle, boxOf } from './fixtures/sessionDrag';
import { expect, grantedTest as test } from './fixtures/grantedExtension';

test.use({ showScrollbars: true });

const fits = (first: number, second: number) =>
  session('S1', 'Fits', [
    win(
      'w1',
      Array.from({ length: first }, (_, i) => tab(`t${i + 1}`))
    ),
    win(
      'w2',
      Array.from({ length: second }, (_, i) => tab(`u${i + 1}`))
    ),
  ]);

// The bar's width and a row's, as drawn.
const widths = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-drag-row-id="t2"]');
    let pane = row?.parentElement ?? null;
    while (pane && pane.dataset.pane !== 'detail') pane = pane.parentElement;
    const list = pane?.querySelector<HTMLElement>('[data-drop-window-id]');
    let scroller = list?.parentElement ?? null;
    while (
      scroller &&
      !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)
    ) {
      scroller = scroller.parentElement;
    }
    if (!row || !scroller) throw new Error('no list');
    return {
      bar: scroller.offsetWidth - scroller.clientWidth,
      row: row.getBoundingClientRect().width,
    };
  });

test.describe('a list that just fits', () => {
  test('keeps its width while a tab is held over its last row and past it', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [fits(9, 1), S3()]);
    const rest = await widths(page);
    const at = await pickUp(page, tabHandle(page, 't1'));
    const last = await boxOf(tabHandle(page, 'u1'));

    await page.mouse.move(at.x, last.y + last.height * 0.9, { steps: 10 });
    await page.waitForTimeout(300);
    expect(await widths(page)).toEqual(rest);

    await page.mouse.move(at.x, last.y + last.height + 10, { steps: 3 });
    await page.waitForTimeout(300);
    expect(await widths(page)).toEqual(rest);
  });

  // The rows hold their transforms until the list draws the move: no frame of the release may show the bar.
  test('draws no bar on any frame of the drop', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [fits(9, 1), S3()]);
    const rest = await widths(page);
    const at = await pickUp(page, tabHandle(page, 't1'));
    const last = await boxOf(tabHandle(page, 'u1'));
    await page.mouse.move(at.x, last.y + last.height * 0.9, { steps: 10 });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const seen: number[] = [];
      (window as unknown as { barsSeen: number[] }).barsSeen = seen;
      const scroller = document
        .querySelector('[data-pane="detail"] [data-drop-window-id]')
        ?.closest<HTMLElement>('[data-drag-fits]');
      if (!scroller) throw new Error('no marked pane');
      const sample = () => {
        seen.push(scroller.offsetWidth - scroller.clientWidth);
        if (seen.length < 40) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { barsSeen: number[] }).barsSeen.length
        )
      )
      .toBe(40);
    const bars = await page.evaluate(
      () => (window as unknown as { barsSeen: number[] }).barsSeen
    );
    expect(new Set(bars)).toEqual(new Set([rest.bar]));
  });
});

// CONTROL: a list that scrolls keeps its bar and its auto-scroll.
test('a list that scrolls keeps its bar through a drag', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId, [fits(16, 8), S3()]);
  const rest = await widths(page);
  expect(rest.bar).toBe(12);
  const at = await pickUp(page, tabHandle(page, 't1'));
  await page.mouse.move(at.x, at.y + 200, { steps: 6 });
  await page.waitForTimeout(200);
  expect(await widths(page)).toEqual(rest);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});
