import { test, expect } from './fixtures/extension';
import { waitForFontsLoaded } from './fixtures/fonts';
import { LIGATURE_ICON_NAMES } from '../src/components/common/iconNames';

// KAN-215. The bundled icon font is a SUBSET, and this is the contract that
// keeps it whole.
//
// `tsc` guarantees every name the code renders is in LIGATURE_ICON_NAMES. It
// cannot see the font file. Add a name to the list without rerunning
// `npm run fonts:fetch` and the type checks while the popup prints the word --
// a missing ligature falls back to its source text, never to tofu.
//
// So every listed name is drawn here with the font the build actually shipped,
// and must lay out as ONE glyph: 24px at a 24px font-size. Its name as text is
// several times that.

test('every listed icon name is a glyph in the bundled font', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await waitForFontsLoaded(page, ['Material Symbols Outlined']);

  // CONTROL, first entry: a real Material Symbols name this extension does not
  // use. It must render as TEXT, which proves two things the list alone cannot:
  // that this measurement can tell a glyph from a word, and that the shipped
  // font really is the subset rather than the whole 344 KB set.
  const unused = 'delete_forever';

  const widths = await page.evaluate(
    async (names) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;top:0;left:0;visibility:hidden';
      document.body.append(host);
      const spans = names.map((name) => {
        const span = document.createElement('span');
        span.className = 'material-symbols-outlined';
        span.style.fontSize = '24px';
        span.textContent = name;
        host.append(span);
        return span;
      });
      await document.fonts.ready;
      return Object.fromEntries(
        spans.map((span) => {
          const range = document.createRange();
          range.selectNodeContents(span);
          return [span.textContent, range.getBoundingClientRect().width];
        })
      );
    },
    [unused, ...LIGATURE_ICON_NAMES]
  );

  expect(widths[unused]).toBeGreaterThan(48);

  const drawnAsText = LIGATURE_ICON_NAMES.filter((name) => widths[name] > 25);
  expect(drawnAsText, 'missing from the font: run npm run fonts:fetch').toEqual(
    []
  );
});
