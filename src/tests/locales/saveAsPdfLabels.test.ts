import { describe, expect, test } from 'vitest';

// KAN-742. Export is offered as Save as PDF; KAN-226/208: the ellipsis says a further step follows.
// U+2026, not "...": some voices read three dots as "dot dot dot".
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const entries = Object.entries(localeFiles);
const nonEnglish = entries.filter(([file]) => !file.includes('/en/'));

const EN: Record<string, string> = {
  'Save session as PDF': 'Save as PDF…',
  'Save open windows as PDF': 'Save open windows as PDF…',
  'Save as PDF': 'Save as PDF…',
};
const TOUR =
  "Copy all links, save as PDF, or delete this session from this menu. Deleting doesn't close your open windows.";

describe('Save as PDF in every locale (KAN-742)', () => {
  test('CONTROL: all 13 locales are read', () => {
    expect(entries).toHaveLength(13);
  });

  test.each(Object.keys(EN))(
    'every locale ends "%s" with a single ellipsis character',
    (key) => {
      for (const [file, strings] of entries) {
        expect(strings[key], file).toMatch(/[^.…]…$/);
      }
    }
  );

  test.each(Object.entries(EN))('en reads %s as %s', (key, value) => {
    expect(localeFiles['/public/locales/en/translation.json'][key]).toBe(value);
  });

  test('every other locale translates them and the tour line', () => {
    const untranslated = nonEnglish.flatMap(([file, strings]) =>
      [...Object.entries(EN), [TOUR, TOUR]]
        .filter(([key, en]) => !strings[key] || strings[key] === en)
        .map(([key]) => `${file}: ${key}`)
    );
    expect(untranslated).toEqual([]);
  });

  test('en defines the tour line', () => {
    expect(localeFiles['/public/locales/en/translation.json'][TOUR]).toBe(TOUR);
  });

  test('no key in any locale says export', () => {
    const exportKeys = entries.flatMap(([file, strings]) =>
      Object.keys(strings)
        .filter((key) => /export/i.test(key))
        .map((key) => `${file}: ${key}`)
    );
    expect(exportKeys).toEqual([]);
  });
});
