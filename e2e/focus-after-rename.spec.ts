import { expect } from './fixtures/extension';
import { grantedTest as test } from './fixtures/grantedExtension';
import {
  groupedWindow,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';
import { pixelsAt } from './fixtures/pixels';
import { CHALK_THEME } from '../src/hooks/useThemeColors';
import type { windowGroupData } from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-389, KAN-400. Enter and Esc end a rename on the title it replaced, in the real popup with real keys.
const grouped = groupedWindow('w1', 'Morning', [
  { groupId: 'g1', title: 'Mail', color: 'blue' },
]);
const w1: windowGroupData = {
  ...grouped,
  tabs: [...grouped.tabs, ...savedWindow('w1', '').tabs],
  tabCount: grouped.tabs.length + 1,
};

const RENAMES = [
  ['session', 'Rename session: Research', 'Rename session: '],
  ['window', 'Rename window: Morning', 'Rename window: '],
  ['group', 'Rename group: Mail', 'Rename group: '],
] as const;

for (const [kind, opener, renamed] of RENAMES) {
  test.describe(`a ${kind} rename`, () => {
    test('Enter saves and leaves focus on the renamed title, the field closed', async ({
      context,
      extensionId,
    }) => {
      const page = await openSaved(context, extensionId, 'popup', {
        sessions: [session('S1', 'Research', [w1])],
      });
      await page.getByRole('button', { name: opener, exact: true }).click();
      const field = page.locator('input:focus');
      await expect(field).toHaveCount(1);
      await field.fill('Renamed');
      await page.keyboard.press('Enter');

      const title = page.getByRole('button', {
        name: renamed + 'Renamed',
        exact: true,
      });
      // Focused, so Enter's keypress did not reach it and reopen the field.
      await expect(title).toBeFocused();
    });

    test('the tick saves and leaves focus on the renamed title, with no focus ring', async ({
      context,
      extensionId,
    }) => {
      const page = await openSaved(context, extensionId, 'popup', {
        sessions: [session('S1', 'Research', [w1])],
      });
      await page.getByRole('button', { name: opener, exact: true }).click();
      await page.locator('input:focus').fill('Renamed');
      await page.getByRole('button', { name: 'Save changes' }).click();

      const title = page.getByRole('button', {
        name: renamed + 'Renamed',
        exact: true,
      });
      await expect(title).toBeFocused();
      // A pointer commit: the title takes focus without drawing a ring.
      expect(await title.evaluate((el) => el.matches(':focus-visible'))).toBe(
        false
      );
    });

    // KAN-685. The arrows moved the caret, not focus: no ring on the title.
    test('an arrow key in the field, then Enter: focus on the title with no ring', async ({
      context,
      extensionId,
    }) => {
      const page = await openSaved(context, extensionId, 'popup', {
        sessions: [session('S1', 'Research', [w1])],
      });
      await page.getByRole('button', { name: opener, exact: true }).click();
      await page.locator('input:focus').fill('Renamed');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Enter');

      const title = page.getByRole('button', {
        name: renamed + 'Renamed',
        exact: true,
      });
      await expect(title).toBeFocused();
      expect(
        await title.evaluate((el) => getComputedStyle(el).outlineStyle)
      ).toBe('none');
    });

    // KAN-685 (pick B). Opened from the keyboard, Enter hands back a ringed title; the ring must not cross its text.
    test('a keyboard rename, then Enter: the ring on the title clears its text', async ({
      context,
      extensionId,
    }) => {
      const page = await openSaved(context, extensionId, 'popup', {
        sessions: [session('S1', 'Research', [w1])],
      });
      const opened = page.getByRole('button', { name: opener, exact: true });
      // Click, Esc, then Shift+Tab and Tab back: the title holds focus under keyboard navigation.
      await opened.click();
      await page.keyboard.press('Escape');
      await expect(opened).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(opened).toBeFocused();
      await page.keyboard.press('Enter');
      await page.locator('input:focus').fill('Renamed');
      await page.keyboard.press('Enter');

      const title = page.getByRole('button', {
        name: renamed + 'Renamed',
        exact: true,
      });
      await expect(title).toBeFocused();
      const ring = await title.evaluate((el) => {
        const s = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const ink = {
          left: Infinity,
          top: Infinity,
          right: -Infinity,
          bottom: -Infinity,
        };
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(n);
          const r = range.getBoundingClientRect();
          if (r.width === 0) continue;
          ink.left = Math.min(ink.left, r.left);
          ink.top = Math.min(ink.top, r.top);
          ink.right = Math.max(ink.right, r.right);
          ink.bottom = Math.max(ink.bottom, r.bottom);
        }
        return {
          style: `${s.outlineStyle} ${s.outlineWidth}`,
          offset: parseFloat(s.outlineOffset),
          box: {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
          },
          ink,
        };
      });
      // PREMISE: the app's 2px ring is drawn, and there is text to clear.
      expect(ring.style).toBe('solid 2px');
      expect(ring.ink.right).toBeGreaterThan(ring.ink.left);
      // The ring's inner edge lies `offset` outside the box (inside, when negative). The text's sides sit 2px
      // clear of it; its line box, taller than the letters, only inside it.
      const inner = {
        left: ring.box.left - ring.offset + 2,
        top: ring.box.top - ring.offset,
        right: ring.box.right + ring.offset - 2,
        bottom: ring.box.bottom + ring.offset,
      };
      expect(ring.ink.left).toBeGreaterThanOrEqual(inner.left);
      expect(ring.ink.right).toBeLessThanOrEqual(inner.right);
      expect(ring.ink.top).toBeGreaterThanOrEqual(inner.top);
      expect(ring.ink.bottom).toBeLessThanOrEqual(inner.bottom);
      // And it paints there, unclipped: the ring colour mid-band on all four sides.
      const mid = ring.offset + 1;
      const cx = (ring.box.left + ring.box.right) / 2;
      const cy = (ring.box.top + ring.box.bottom) / 2;
      expect(
        await pixelsAt(page, [
          [cx, ring.box.top - mid],
          [cx, ring.box.bottom + mid - 1],
          [ring.box.left - mid, cy],
          [ring.box.right + mid - 1, cy],
        ])
      ).toEqual(Array(4).fill(CHALK_THEME.TEXT_COLOR));
    });

    test('Esc cancels and leaves focus on the title', async ({
      context,
      extensionId,
    }) => {
      const page = await openSaved(context, extensionId, 'popup', {
        sessions: [session('S1', 'Research', [w1])],
      });
      await page.getByRole('button', { name: opener, exact: true }).click();
      await page.keyboard.type('Draft');
      await page.keyboard.press('Escape');

      await expect(
        page.getByRole('button', { name: opener, exact: true })
      ).toBeFocused();
    });
  });
}
