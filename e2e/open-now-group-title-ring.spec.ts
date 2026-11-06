import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { seedSettings } from './fixtures/seed';
import { standIn } from './fixtures/standInPages';

// KAN-722. The Open now group title's box ends at its text, so a ring inside
// the box crossed the last letter. Outside it must clear the text and not clip.

const LONG = 'A group title long enough to run out of room in the pane';

for (const title of ['Kyoto trip', 'Mail', LONG]) {
  test(`the ring on "${title}" clears its text and is not clipped`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await serviceWorker.evaluate(
      async ({ urls, title }) => {
        const w = await chrome.windows.create({ focused: false, url: urls });
        const tabs = await chrome.tabs.query({ windowId: w!.id });
        const [first, ...rest] = tabs.map((t) => t.id!);
        const groupId = await chrome.tabs.group({
          tabIds: [first, ...rest],
          createProperties: { windowId: w!.id },
        });
        await chrome.tabGroups.update(Number(groupId), { title });
      },
      { urls: [standIn('Temple'), standIn('Bus')], title }
    );
    await seedSettings(context, { foldSavedSessionInTabView: false });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    const button = page
      .locator('[data-pane="open-now"]')
      .getByRole('button', { name: `Rename group: ${title}`, exact: true });
    await button.waitFor();
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();

    const ring = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      const offset = parseFloat(style.outlineOffset);
      const width = parseFloat(style.outlineWidth);
      const box = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const ink = range.getBoundingClientRect();
      const outer = {
        left: box.left - offset - width,
        top: box.top - offset - width,
        right: box.right + offset + width,
        bottom: box.bottom + offset + width,
      };
      const clippedBy: string[] = [];
      for (let p = el.parentElement; p !== null; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const r = p.getBoundingClientRect();
        if (
          outer.left < r.left ||
          outer.top < r.top ||
          outer.right > r.right ||
          outer.bottom > r.bottom
        ) {
          clippedBy.push(p.tagName + '.' + p.className);
        }
      }
      return {
        style: style.outlineStyle,
        innerRight: box.right + offset,
        inkRight: Math.min(ink.right, box.right),
        clippedBy,
      };
    });
    expect(ring.style).toBe('solid');
    expect(ring.innerRight).toBeGreaterThanOrEqual(ring.inkRight);
    expect(ring.clippedBy).toEqual([]);
  });
}
