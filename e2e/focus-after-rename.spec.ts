import { expect } from './fixtures/extension';
import { grantedTest as test } from './fixtures/grantedExtension';
import {
  groupedWindow,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';
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
