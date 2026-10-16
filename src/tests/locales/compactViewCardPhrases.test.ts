import { describe, expect, test } from 'vitest';

// KAN-623. A missing key renders English silently; only the values show it.
const localeFiles = import.meta.glob<Record<string, string>>(
  '/public/locales/*/translation.json',
  { import: 'default', eager: true }
);
const LONG =
  'Your compact view is still here. Click Tab Keeper in the toolbar as always, or {{icon}} to switch back.';
const SHORT =
  'Your compact view is still here. Click Tab Keeper in the toolbar as always.';
const others = Object.entries(localeFiles).filter(
  ([path]) => !path.includes('/en/')
);

describe('the compact-view card in every locale (KAN-623)', () => {
  test('CONTROL: twelve other locales were loaded', () => {
    expect(others).toHaveLength(12);
  });

  test.each(others)(
    '%s translates both, keeps {{icon}} once, names Tab Keeper',
    (_path, dict) => {
      for (const key of [LONG, SHORT]) {
        expect(dict[key]).toEqual(expect.any(String));
        expect(dict[key]).not.toBe(key);
        expect(dict[key]).toContain('Tab Keeper');
      }
      expect(dict[LONG].split('{{icon}}')).toHaveLength(2);
      expect(dict[SHORT]).not.toContain('{{icon}}');
    }
  );
});
