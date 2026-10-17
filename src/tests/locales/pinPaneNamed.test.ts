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

// KAN-652. The tour's pin card says where to turn the pin off. Pin Tab Keeper
// in new windows moved from Sessions to Quick access, and the sentence and the
// rail's label are separate strings, so each locale must name the new pane.
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

const PIN_SENTENCE =
  'It becomes a small tab at the start of your tab bar, here and in every window Tab Keeper opens. You can turn this off in Settings → Quick access.';

describe('the pin card sends the user to Quick access (KAN-652)', () => {
  test.each(Object.keys(LOCALES))('%s', (locale) => {
    const strings = LOCALES[locale];
    expect(strings['Quick access']).toBeTruthy();
    expect(strings[PIN_SENTENCE]).toContain(strings['Quick access']);
    expect(strings[PIN_SENTENCE]).not.toContain(strings.Sessions);
  });

  // keyCoverage holds every t() key in src to a key in en, so with no en key
  // pointing at Settings → Sessions, no code can show one.
  test('no English string points at Settings → Sessions', () => {
    const pointers = Object.entries(en).filter(
      ([key, value]) =>
        key.includes('Settings → Sessions') ||
        value.includes('Settings → Sessions')
    );
    expect(pointers).toEqual([]);
  });
});
