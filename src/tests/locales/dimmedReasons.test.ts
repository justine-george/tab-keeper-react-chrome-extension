import { describe, expect, test } from 'vitest';

// KAN-886. Why a dimmed Add current window or Back to your tab does nothing, in every language.
// import.meta.glob, not node:fs: see keyCoverage.test.ts.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const APPROVED_EN = {
  AddWindowNothingToAdd:
    'Nothing to add: only Tab Keeper is open in this window',
  BackNowhereToGo:
    'Nowhere to go back to: only Tab Keeper is open in this window',
};
const langs = Object.entries(localeFiles).map(([path, dict]) => ({
  lang: path.split('/')[3],
  dict,
}));

test('all 13 languages are checked', () => {
  expect(langs).toHaveLength(13);
});

describe.each(Object.entries(APPROVED_EN))('%s (KAN-886)', (key, en) => {
  test('en reads as approved', () => {
    expect(langs.find((l) => l.lang === 'en')?.dict[key]).toBe(en);
  });

  test.each(langs.filter((l) => l.lang !== 'en'))(
    '$lang translates it',
    ({ dict }) => {
      expect(typeof dict[key]).toBe('string');
      expect(dict[key]).not.toBe(en);
    }
  );
});
