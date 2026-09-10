import { describe, expect, test } from 'vitest';

// KAN-148. The product has ONE name in every locale, and it is the name on the
// Chrome Web Store listing the user installed from.
//
// Four locales used to translate or transliterate it, and two of those then
// disagreed with themselves: zh called it 标签管理器 in the header and
// 选项卡管理器 on the About screen, and ru called it Хранитель Вкладок in the
// header and Tab Keeper everywhere else. So the same product had two names on
// two screens, neither of which matched the listing.
//
// Read through import.meta.glob rather than node:fs for the reason
// keyCoverage.test.ts sets out at length: tsconfig's `types` array is
// deliberately without "node".
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const locales = Object.entries(localeFiles).map(
  ([path, dict]) => [path.split('/')[3], dict] as const
);

const BRAND = 'Tab Keeper';

// Every key whose value names the product. Listed rather than discovered,
// because a scan for "the values that mention the brand" can only find the
// ones that already spell it correctly -- it would go green precisely when a
// locale stopped using the name at all, which is the bug.
const KEYS_THAT_NAME_THE_PRODUCT = [
  'Tab Keeper',
  'Thank you for using this app!',
  'RequestUserReviewHeader',
  'TabGroupsPromptTitle',
];

// The forms that were actually in the files, plus the transliterations a
// well-meaning translator would reach for next.
const TRANSLATED_FORMS = [
  'टैब कीपर', // hi
  'タブキーパー', // ja
  'Хранитель Вкладок', // ru
  'Хранитель вкладок',
  '标签管理器', // zh
  '选项卡管理器', // zh, the second one
];

describe('the product is named the same way everywhere', () => {
  // The control for the sweep below: if this ever fails, the glob is broken and
  // a green sweep would mean nothing rather than meaning the locales are clean.
  test('CONTROL: all ten locales were loaded', () => {
    expect(locales).toHaveLength(10);
    expect(locales.map(([name]) => name).sort()).toEqual([
      'de',
      'en',
      'es',
      'fr',
      'hi',
      'it',
      'ja',
      'pt',
      'ru',
      'zh',
    ]);
  });

  test.each(locales)('%s spells the product name in full', (_name, dict) => {
    for (const key of KEYS_THAT_NAME_THE_PRODUCT) {
      expect(dict[key], `${key} is missing`).toBeDefined();
      expect(dict[key]).toContain(BRAND);
    }
  });

  // The other half. The check above passes for a value that says BOTH -- and
  // "Tab Keeper (标签管理器)" is exactly the compromise this rule exists to
  // refuse, since it still leaves two names on screen.
  test.each(locales)('%s carries no translated name at all', (_name, dict) => {
    for (const [key, value] of Object.entries(dict)) {
      for (const form of TRANSLATED_FORMS) {
        expect(value, `${key} still contains ${form}`).not.toContain(form);
      }
    }
  });
});
