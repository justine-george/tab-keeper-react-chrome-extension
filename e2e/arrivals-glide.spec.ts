import type { Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openSaved, savedWindow, session } from './fixtures/savedWindows';
import { documentLanded } from './fixtures/landed';
import {
  between,
  samples,
  startSampling,
  topOf,
} from './fixtures/glideSamples';

// KAN-991: a session saved in another open page, or arriving by sync, comes in
// as one saved here does (KAN-988). His picks, round 6: it arrives plain (each
// page keeps its own selection); several at once come down together (A); one
// landing mid-list slides out from under the row above (C). KAN-992 (pick B):
// with the list scrolled down, nothing the user is reading moves.
//
// The arrival is written here as another page writes it: localStorage, then
// the post on the shared channel (KAN-925). A second tab would hide this one,
// and a hidden page draws no frames.

const SESSIONS = ['S1', 'S2', 'S3', 'S4'].map((id) =>
  session(id, `Session ${id}`, [savedWindow(`${id}-w`, 'Window', 2)])
);
const MANY = [...Array(14).keys()].map((i) =>
  session(`S${i + 1}`, `Session ${i + 1}`, [
    savedWindow(`S${i + 1}-w`, 'Window', 2),
  ])
);
const arrival = (id: string, title: string) =>
  session(id, title, [savedWindow(`${id}-w`, 'Window', 2)]);
const rowOf = (id: string) =>
  `[data-pane="sessions"] [data-drag-row-id="${id}"]`;
const contentOf = (id: string) => `${rowOf(id)} > [data-drag-handle-row]`;

// The opacity in between fully hidden and fully shown: it faded in.
const faded = (ops: number[]) => ops.some((v) => v > 0.05 && v < 0.95);

async function writeAsAnotherPage(
  page: Page,
  made: ReturnType<typeof arrival>[],
  at: number
): Promise<void> {
  await page.evaluate(
    ({ made, at }) => {
      const raw = localStorage.getItem('tabContainerData');
      if (raw === null) throw new Error('nothing stored');
      const stored = JSON.parse(raw);
      stored.tabGroups.splice(at, 0, ...made);
      localStorage.setItem('tabContainerData', JSON.stringify(stored));
      new BroadcastChannel('tab-keeper-stored').postMessage('tabContainerData');
    },
    { made, at }
  );
}

async function popup(
  context: Parameters<typeof openSaved>[0],
  extensionId: string,
  sessions = SESSIONS,
  selected = 'S2'
): Promise<Page> {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions,
    selected,
  });
  await documentLanded(page);
  return page;
}

// The session the right pane shows: the selected one.
const shows = (page: Page, title: string) =>
  expect(
    page.getByRole('button', { name: `Rename session: ${title}`, exact: true })
  ).toBeVisible();

test.describe('a session saved in another open page', () => {
  test('slides in from the top with the sessions below, plain, without a fade', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const from = await topOf(page.locator(rowOf('S1')));

    await startSampling(page, {
      next: rowOf('S1'),
      new: rowOf('N1'),
      'new:op': rowOf('N1'),
    });
    await writeAsAnotherPage(page, [arrival('N1', 'Lisbon')], 0);
    const s = await samples(page);
    const to = await topOf(page.locator(rowOf('S1')));
    const pitch = to - from;

    expect(pitch).toBeGreaterThan(40);
    expect(await topOf(page.locator(rowOf('N1')))).toBeCloseTo(from, 0);
    expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
    expect(between(s.new, from - pitch, from).length).toBeGreaterThanOrEqual(3);
    expect(faded(s['new:op'])).toBe(false);
    // It arrives plain: this page's selection stays on S2.
    await shows(page, 'Session S2');
  });

  test('a key pressed here last does not make it instant: it was not made here', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    await page.keyboard.press('Shift');
    const from = await topOf(page.locator(rowOf('S1')));

    await startSampling(page, { next: rowOf('S1') });
    await writeAsAnotherPage(page, [arrival('N1', 'Lisbon')], 0);
    const s = await samples(page);
    const to = await topOf(page.locator(rowOf('S1')));

    expect(to - from).toBeGreaterThan(40);
    expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
  });

  test('with Reduce motion it is instant', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const from = await topOf(page.locator(rowOf('S1')));

    await startSampling(page, { next: rowOf('S1'), new: rowOf('N1') });
    await writeAsAnotherPage(page, [arrival('N1', 'Lisbon')], 0);
    const s = await samples(page);
    const to = await topOf(page.locator(rowOf('S1')));

    expect(to - from).toBeGreaterThan(40);
    expect(between(s.next, from, to)).toEqual([]);
    expect(between(s.new, from - (to - from), from)).toEqual([]);
  });

  test('several at once come down together, as one', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const from = await topOf(page.locator(rowOf('S1')));

    await startSampling(page, {
      next: rowOf('S1'),
      n1: rowOf('N1'),
      n2: rowOf('N2'),
      n3: rowOf('N3'),
      'n3:op': rowOf('N3'),
    });
    await writeAsAnotherPage(
      page,
      [arrival('N1', 'One'), arrival('N2', 'Two'), arrival('N3', 'Three')],
      0
    );
    const s = await samples(page);
    const to = await topOf(page.locator(rowOf('S1')));
    const pitch = (to - from) / 3;

    expect(pitch).toBeGreaterThan(40);
    expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
    expect(between(s.n1, from - 3 * pitch, from).length).toBeGreaterThanOrEqual(
      3
    );
    // Every frame they are drawn, they keep their spacing: one block moving.
    const frames = s.n1.flatMap((n1, i) =>
      Number.isNaN(n1) ? [] : [[n1, s.n2[i], s.n3[i], s.next[i]]]
    );
    expect(frames.length).toBeGreaterThan(5);
    const apart = frames.filter(
      ([n1, n2, n3, next]) =>
        Math.abs(n2 - n1 - pitch) > 1 ||
        Math.abs(n3 - n2 - pitch) > 1 ||
        Math.abs(next - n3 - pitch) > 1
    );
    expect(apart).toEqual([]);
    expect(faded(s['n3:op'])).toBe(false);
  });

  test('one landing mid-list slides out from under the row above', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const place = await topOf(page.locator(rowOf('S3')));
    const above = await topOf(page.locator(rowOf('S2')));

    await startSampling(page, {
      next: rowOf('S3'),
      above: rowOf('S2'),
      row: rowOf('N1'),
      content: contentOf('N1'),
      'row:op': rowOf('N1'),
      'row:ov': rowOf('N1'),
    });
    await writeAsAnotherPage(page, [arrival('N1', 'Lisbon')], 2);
    const s = await samples(page);
    const to = await topOf(page.locator(rowOf('S3')));
    const pitch = to - place;

    expect(pitch).toBeGreaterThan(40);
    expect(await topOf(page.locator(rowOf('N1')))).toBeCloseTo(place, 0);
    // The row above never moves: it is the edge.
    expect(s.above.filter((y) => Math.abs(y - above) > 0.5)).toEqual([]);
    expect(between(s.next, place, to).length).toBeGreaterThanOrEqual(3);
    // The row's box is in its place from its first frame, clipping what it
    // holds, which comes down into it from a row above.
    const drawn = s.row.flatMap((y, i) => (Number.isNaN(y) ? [] : [i]));
    expect(drawn.filter((i) => Math.abs(s.row[i] - place) > 0.5)).toEqual([]);
    expect(
      between(s.content, place - pitch, place).length
    ).toBeGreaterThanOrEqual(3);
    expect(drawn.some((i) => s['row:ov'][i] === 1)).toBe(true);
    expect(faded(s['row:op'])).toBe(false);
    // The clip is let go once it lands.
    await expect
      .poll(() =>
        page
          .locator(rowOf('N1'))
          .evaluate((el) => getComputedStyle(el).overflowY)
      )
      .toBe('visible');
  });
});

// KAN-992. Scrolled down, an arrival above used to pull the list back up to
// the selected session (KAN-143's follow saw its index change).
test.describe('scrolled down when a session arrives above', () => {
  test('nothing in view moves, and the selection is not followed', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId, MANY, 'S2');
    const list = page.locator(rowOf('S1')).locator('xpath=..');
    await list.evaluate((el) => {
      let sc: HTMLElement | null = el;
      while (
        sc !== null &&
        !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)
      )
        sc = sc.parentElement;
      if (sc === null) throw new Error('no scroller');
      sc.scrollTop = 6 * 71;
    });
    await documentLanded(page);
    const scrollTop = () =>
      page.locator(rowOf('S1')).evaluate((el) => {
        let sc: HTMLElement | null = el.parentElement;
        while (
          sc !== null &&
          !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)
        )
          sc = sc.parentElement;
        return sc?.scrollTop ?? NaN;
      });
    const before = await scrollTop();
    const a = await topOf(page.locator(rowOf('S9')));
    const b = await topOf(page.locator(rowOf('S10')));

    await startSampling(page, { a: rowOf('S9'), b: rowOf('S10') });
    await writeAsAnotherPage(page, [arrival('N1', 'Lisbon')], 0);
    const s = await samples(page);

    await expect(page.locator(rowOf('N1'))).toBeAttached();
    expect(s.a.filter((y) => Math.abs(y - a) > 0.5)).toEqual([]);
    expect(s.b.filter((y) => Math.abs(y - b) > 0.5)).toEqual([]);
    expect(await scrollTop()).toBeGreaterThan(before + 40);
    await shows(page, 'Session 2');
  });
});
