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
  // KAN-227 CONTROL, TEMPORARY: a deliberate failure, to prove a red shard
  // fails "Build before merge". Reverted in the next commit.
  expect(1, 'deliberate CI control failure').toBe(2);

  const drawnAsText = LIGATURE_ICON_NAMES.filter((name) => widths[name] > 25);
  expect(drawnAsText, 'missing from the font: run npm run fonts:fetch').toEqual(
    []
  );
});

// KAN-218. The export toolbar's knob draws its glyph FILLED, through the FILL
// axis. A static subset has no such axis: `font-variation-settings: 'FILL' 1`
// is then accepted and ignored, and the "filled" glyph is the outline. So the
// ink is counted rather than the declaration read.
test('the bundled icon font can draw a glyph filled', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await waitForFontsLoaded(page, ['Material Symbols Outlined']);

  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'fill-probe';
    host.style.cssText =
      'position:fixed;top:0;left:0;z-index:99999;display:flex;background:#fff';
    for (const fill of [0, 1]) {
      const span = document.createElement('span');
      span.className = 'material-symbols-outlined';
      span.dataset.fill = String(fill);
      span.style.cssText = `font-size:96px;color:#000;font-variation-settings:'FILL' ${fill}`;
      span.textContent = 'dark_mode';
      host.append(span);
    }
    document.body.append(host);
  });

  const inkOf = async (fill: number) => {
    const png = await page
      .locator(`#fill-probe [data-fill="${fill}"]`)
      .screenshot();
    return page.evaluate(async (base64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 128) dark++;
      }
      return dark;
    }, png.toString('base64'));
  };

  const outlined = await inkOf(0);
  const filled = await inkOf(1);

  // CONTROL: the outline itself has ink, so a zero-vs-zero read cannot pass.
  expect(outlined, 'the outlined moon draws something').toBeGreaterThan(200);
  expect(
    filled / outlined,
    `filled ${filled}px against outlined ${outlined}px`
  ).toBeGreaterThan(1.5);
});
