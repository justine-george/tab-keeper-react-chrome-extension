import { describe, expect, test } from 'vitest';

import { dictFor, localeDicts } from '../setup/localeT';

// KAN-742. Export is offered as Save as PDF; KAN-226/208: the ellipsis says a further step follows.
// U+2026, not "...": some voices read three dots as "dot dot dot".
const entries = localeDicts;
const nonEnglish = entries.filter(([lang]) => lang !== 'en');

const EN: Record<string, string> = {
  'Save session as PDF': 'Save as PDF…',
  'Save open windows as PDF': 'Save open windows as PDF…',
  'Save as PDF': 'Save as PDF…',
};
const TOUR =
  "Copy all links, save as PDF, or delete this session from this menu. Deleting doesn't close your open windows.";

describe('Save as PDF in every locale (KAN-742)', () => {
  test.each(Object.keys(EN))(
    'every locale ends "%s" with a single ellipsis character',
    (key) => {
      for (const [file, strings] of entries) {
        expect(strings[key], file).toMatch(/[^.…]…$/);
      }
    }
  );

  test.each(Object.entries(EN))('en reads %s as %s', (key, value) => {
    expect(dictFor('en')[key]).toBe(value);
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
    expect(dictFor('en')[TOUR]).toBe(TOUR);
  });

  // His word (2026-10-22): Save as HTML is gone for good.
  test('no locale defines Save as HTML', () => {
    const left = entries
      .filter(([, strings]) => 'Save as HTML' in strings)
      .map(([file]) => file);
    expect(left).toEqual([]);
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
