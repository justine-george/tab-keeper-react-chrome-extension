import { describe, expect, test } from 'vitest';

import de from '../../../public/locales/de/translation.json';
import en from '../../../public/locales/en/translation.json';
import es from '../../../public/locales/es/translation.json';
import fr from '../../../public/locales/fr/translation.json';
import hi from '../../../public/locales/hi/translation.json';
import it from '../../../public/locales/it/translation.json';
import ja from '../../../public/locales/ja/translation.json';
import ko from '../../../public/locales/ko/translation.json';
import pt from '../../../public/locales/pt/translation.json';
import ru from '../../../public/locales/ru/translation.json';
import sv from '../../../public/locales/sv/translation.json';
import zh from '../../../public/locales/zh/translation.json';
import zhTW from '../../../public/locales/zh-TW/translation.json';

// KAN-437. A missing key renders English silently; only the values show it.
const LOCALES: Record<string, Record<string, string>> = {
  de,
  en,
  es,
  fr,
  hi,
  it,
  ja,
  ko,
  pt,
  ru,
  sv,
  zh,
  'zh-TW': zhTW,
};

describe('"Open in popup" in every locale (KAN-437)', () => {
  test.each(Object.keys(LOCALES))(
    '%s names it, apart from Open full view',
    (lang) => {
      const value = LOCALES[lang]['Open in popup'];
      expect(typeof value === 'string' && value.length > 0).toBe(true);
      expect(value).not.toBe(LOCALES[lang]['Open full view']);
    }
  );

  test.each(Object.keys(LOCALES).filter((l) => l !== 'en'))(
    '%s translates it',
    (lang) => {
      const value = LOCALES[lang]['Open in popup'];
      expect(value).toEqual(expect.any(String));
      expect(value).not.toBe('Open in popup');
    }
  );
});
