import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-870. The selected session row's actions (Open, Switch in the popup,
// Replace) are an icon over a word. Each box was a fixed 57px, so a wider word
// spilled into the next one and past the list's edge: ru/it/pt touched at
// Chrome's Medium font size, most Latin locales overlapped at Large, and the
// list scrolled sideways. Pick A: a box is 57px where its word fits and grows
// to the word plus 6px a side where it doesn't.
//
// Chrome's font size setting (Medium 16, Large 20, Very large 24) is the
// root's font size here, as the app sizes text in rem.

const LOCALES = [
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
];
const ROOT_SIZES = [16, 20, 24];
const BOX_MIN = 57;
const LABEL_SIDE = 6;
const MIN_GAP = 2 * LABEL_SIDE;

const SURFACES = {
  // The list is its narrowest (356px) below 1100px.
  'full view': {
    query: '?view=tab',
    viewport: { width: 1000, height: 800 },
    actions: 2,
  },
  popup: { query: '', viewport: { width: 790, height: 550 }, actions: 3 },
} as const;

for (const [surface, s] of Object.entries(SURFACES)) {
  test(`${surface}: every locale and font size fits the selected row's actions in the list`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, {
      ...buildContainer([
        buildSession({
          tabGroupId: 'a',
          title: 'Trip to Lisbon',
          isSelected: true,
        }),
        buildSession({ tabGroupId: 'b', title: 'Weekend reading' }),
      ]),
      selectedTabGroupId: 'a',
    });
    const wrong: string[] = [];
    for (const lang of LOCALES) {
      // Unfolded, so the full view selects a row as the popup does.
      await seedSettings(context, {
        language: lang,
        foldSavedSessionInTabView: false,
      });
      const page = await context.newPage();
      await page.setViewportSize(s.viewport);
      await page.goto(`chrome-extension://${extensionId}/index.html${s.query}`);
      const strip = page.locator('[data-pane="sessions"] [data-row-actions]');
      // PREMISE: the selected row shows its actions, each with a word.
      await expect(strip.locator('p')).toHaveCount(s.actions);
      for (const size of ROOT_SIZES) {
        await page.evaluate(
          (px) => (document.documentElement.style.fontSize = `${px}px`),
          size
        );
        const m = await strip.evaluate((el) => {
          const list = el.closest('[data-pane="sessions"]')!;
          const scroller = [list, ...list.querySelectorAll('*')].find((e) =>
            /auto|scroll/.test(getComputedStyle(e).overflowY)
          ) as HTMLElement;
          const edge =
            scroller.getBoundingClientRect().left + scroller.clientWidth;
          return {
            sideways: scroller.scrollWidth - scroller.clientWidth,
            boxes: [...el.children].map((b) => b.getBoundingClientRect().width),
            labels: [...el.querySelectorAll('p')].map((p) => {
              const r = p.getBoundingClientRect();
              return { left: r.left, right: r.right, width: r.width };
            }),
            edge,
          };
        });
        const at = `${lang} ${size}px`;
        if (m.sideways > 0)
          wrong.push(`${at}: list scrolls ${m.sideways}px sideways`);
        m.labels.forEach((l, i) => {
          const want = Math.max(BOX_MIN, l.width + MIN_GAP);
          if (Math.abs(m.boxes[i] - want) > 0.5)
            wrong.push(
              `${at}: box ${i} is ${m.boxes[i].toFixed(1)}px, want ${want.toFixed(1)}`
            );
          const next = m.labels[i + 1];
          if (next && next.left - l.right < MIN_GAP - 0.5)
            wrong.push(
              `${at}: words ${i} and ${i + 1} ${(next.left - l.right).toFixed(1)}px apart`
            );
        });
        const last = m.labels[m.labels.length - 1];
        if (m.edge - last.right < LABEL_SIDE - 0.5)
          wrong.push(
            `${at}: last word ${(m.edge - last.right).toFixed(1)}px from the list's edge`
          );
      }
      await page.close();
    }
    expect(wrong).toEqual([]);
  });
}
