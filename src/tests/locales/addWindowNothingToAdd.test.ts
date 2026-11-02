import { describe, expect, test } from 'vitest';

// KAN-886. The dimmed Add current window's reason, in every language.
// import.meta.glob, not node:fs: see keyCoverage.test.ts.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const KEY = 'AddWindowNothingToAdd';
const valueByLang = new Map(
  Object.entries(localeFiles).map(([path, dict]) => [
    path.split('/')[3],
    dict[KEY],
  ])
);
const en = valueByLang.get('en');
const others = [...valueByLang].filter(([lang]) => lang !== 'en');

describe('Add current window’s nothing-to-add reason (KAN-886)', () => {
  test('all 13 languages are checked', () => {
    expect(valueByLang.size).toBe(13);
  });

  test('en reads as approved', () => {
    expect(en).toBe('Nothing to add: only Tab Keeper is open in this window');
  });

  test.each(others)('%s translates it', (_lang, value) => {
    expect(typeof value).toBe('string');
    expect(value).not.toBe(en);
  });
});
