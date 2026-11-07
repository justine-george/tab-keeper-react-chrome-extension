// KAN-368. A held row's transform extends the list's scrollable overflow: a list that fits must not grow a scrollbar mid-drag.
import { type Page } from '@playwright/test';
import {
  openPopup,
  session,
  win,
  tab,
  S3,
  detailPane,
  layout,
  scrollRange,
  settled,
} from './fixtures/betweenSessions';
import { pickUp, tabHandle, groupHandle, boxOf } from './fixtures/sessionDrag';
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

const detailScrollTop = async (page: Page) =>
  (await detailPane(page)).scrollTop;

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
    await page.mouse.move(at.x, last.y + last.height * 0.25, { steps: 10 });
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
    // PREMISE: a drop among the rows, not a new window, whose list is longer.
    expect(await layout(page, 'S1')).toEqual([
      't2 t3 t4 t5 t6 t7 t8 t9',
      'u1 t1',
    ]);
  });
});

// KAN-944. Under half a row free: the room row a scrolling list has, with no bar, reached by holding at the bottom edge.
test.describe('a list with under half a row free', () => {
  const lit = (page: Page) =>
    page.locator('[data-new-window-target="last"][data-landing]');
  const toTheRoom = async (page: Page, x: number) => {
    const pane = await detailPane(page);
    await page.mouse.move(x, pane.bottom - 4, { steps: 8 });
    await expect(lit(page)).toHaveCount(1);
    await expect.poll(() => detailScrollTop(page)).toBeGreaterThan(0);
  };

  test('a tab held at the bottom reaches New window and makes a window', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [fits(9, 1), S3()]);
    const rest = await widths(page);
    const at = await pickUp(page, tabHandle(page, 't1'));
    await toTheRoom(page, at.x);
    expect(await widths(page)).toEqual(rest);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['t2 t3 t4 t5 t6 t7 t8 t9', 'u1', 't1']);
  });

  // CONTROL: a held group folds, which frees its own room, so it needs no room row.
  test('a group held at the bottom reaches New window with no room row', async ({
    context,
    extensionId,
  }) => {
    const grouped = session('S1', 'Fits', [
      win(
        'w1',
        [
          tab('t1', 'g'),
          tab('t2', 'g'),
          ...Array.from({ length: 6 }, (_, i) => tab(`t${i + 3}`)),
        ],
        [{ groupId: 'g', title: 'Group', color: 'blue' }]
      ),
      win('w2', [tab('u1')]),
    ]);
    const page = await openPopup(context, extensionId, [grouped, S3()]);
    const at = await pickUp(page, groupHandle(page, 'g'));
    const pane = await detailPane(page);
    await page.mouse.move(at.x, pane.bottom - 4, { steps: 8 });
    await expect(lit(page)).toHaveCount(1);
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-drag-new-window')
      )
    ).toBe('');
    await page.mouse.up();

    await expect
      .poll(async () => (await layout(page, 'S1')).slice(-1))
      .toEqual(['t1* t2*']);
  });

  // Worst path: KAN-887 keeps a room in view, but in a list that fits no scroll can take it out of view, so it would stay for good.
  test('Esc at the bottom moves nothing and leaves the list as it was', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [fits(9, 1), S3()]);
    const rest = await widths(page);
    const at = await pickUp(page, tabHandle(page, 't1'));
    await toTheRoom(page, at.x);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect.poll(() => scrollRange(page)).toBe(0);
    expect(await detailScrollTop(page)).toBe(0);
    await page.waitForTimeout(500);
    expect(await widths(page)).toEqual(rest);
    expect(await layout(page, 'S1')).toEqual([
      't1 t2 t3 t4 t5 t6 t7 t8 t9',
      'u1',
    ]);
    expect(
      await page.evaluate(() =>
        document.documentElement.hasAttribute('data-new-window-room-kept')
      )
    ).toBe(false);
  });

  test('a drop back among the rows at the bottom draws no bar', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [fits(9, 1), S3()]);
    const rest = await widths(page);
    const at = await pickUp(page, tabHandle(page, 't1'));
    await toTheRoom(page, at.x);
    await settled(page);
    // Well above the bottom edge, so the list holds still under the aim.
    const aim = await boxOf(tabHandle(page, 't5'));
    await page.mouse.move(at.x, aim.y + aim.height * 0.25, { steps: 3 });
    await settled(page);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['t2 t3 t1 t4 t5 t6 t7 t8 t9', 'u1']);
    await expect.poll(() => scrollRange(page)).toBe(0);
    await page.waitForTimeout(500);
    expect(await widths(page)).toEqual(rest);
  });

  // CONTROL: half a row free or more, no room: the target lights where the list ends, and nothing scrolls.
  test('8+1 gets no room row and nothing scrolls', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [fits(8, 1), S3()]);
    const at = await pickUp(page, tabHandle(page, 't1'));
    const last = await boxOf(tabHandle(page, 'u1'));
    await page.mouse.move(at.x, last.y + last.height + 20, { steps: 8 });
    await expect(lit(page)).toHaveCount(1);
    expect(await detailScrollTop(page)).toBe(0);
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-drag-new-window')
      )
    ).toBe('');
    await page.keyboard.press('Escape');
    await page.mouse.up();
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
