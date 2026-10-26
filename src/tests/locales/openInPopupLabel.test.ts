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

describe('"Open compact view" in every locale (KAN-437)', () => {
  test.each(Object.keys(LOCALES))(
    '%s names it, apart from Open full view',
    (lang) => {
      const value = LOCALES[lang]['Open compact view'];
      expect(typeof value === 'string' && value.length > 0).toBe(true);
      expect(value).not.toBe(LOCALES[lang]['Open full view']);
    }
  );

  test.each(Object.keys(LOCALES).filter((l) => l !== 'en'))(
    '%s translates it',
    (lang) => {
      const value = LOCALES[lang]['Open compact view'];
      expect(value).toEqual(expect.any(String));
      expect(value).not.toBe('Open compact view');
    }
  );

  // The label it replaced (Justine, 2026-10-08): a leftover key is dead text.
  test.each(Object.keys(LOCALES))(
    '%s no longer has "Open in popup"',
    (lang) => {
      expect(LOCALES[lang]).not.toHaveProperty(['Open in popup']);
    }
  );
});

describe('"Back to your tab" in every locale (KAN-509, KAN-785)', () => {
  test.each(Object.keys(LOCALES))(
    '%s names it, apart from Open compact view and Back',
    (lang) => {
      const value = LOCALES[lang]['Back to your tab'];
      expect(typeof value === 'string' && value.length > 0).toBe(true);
      expect(value).not.toBe(LOCALES[lang]['Open compact view']);
      expect(value).not.toBe(LOCALES[lang]['Back']);
    }
  );

  test.each(Object.keys(LOCALES).filter((l) => l !== 'en'))(
    '%s translates it',
    (lang) => {
      expect(LOCALES[lang]['Back to your tab']).not.toBe('Back to your tab');
    }
  );

  // KAN-785. "Last tab" read as the rightmost one; a leftover key is dead text.
  test.each(Object.keys(LOCALES))(
    '%s no longer has "Back to last tab"',
    (lang) => {
      expect(LOCALES[lang]).not.toHaveProperty(['Back to last tab']);
    }
  );
});

// KAN-787. On a button "Open now" read as a command; English only, keys stay and en re-maps.
const CURRENTLY_OPEN: Record<string, string> = {
  'Open now': 'Currently open',
  'Close Open now': 'Close the Currently open panel',
  'Resize Open now': 'Resize the Currently open panel',
  'Open now shows every window and tab in Chrome, kept up to date as you browse.':
    // KAN-789 added "on this device".
    'Currently open shows every Chrome window and tab on this device, and stays up to date as you browse.',
  'Type in the search box to find an open tab. Drag the edge to make this wider, or press {{icon}} to give Open now the whole view.':
    'Type in the search box to find an open tab. Drag the edge to make this wider, or press {{icon}} to give Currently open the whole view.',
  'Type in the search box to find an open tab. Press {{icon}} to give Open now the whole view.':
    'Type in the search box to find an open tab. Press {{icon}} to give Currently open the whole view.',
  'Open now is tucked in here while the window is narrow. Press {{icon}} to see and search every open tab.':
    'Currently open is tucked in here while the window is narrow. Press {{icon}} to see and search every open tab.',
  // KAN-808.
  'Fold Open now away': 'Fold the Currently open panel away',
  'Show Open now': 'Show the Currently open panel',
  'Open now is tucked in here. Press {{icon}} to see and search every open tab.':
    'Currently open is tucked in here. Press {{icon}} to see and search every open tab.',
};

describe('"Currently open" names the pane in English (KAN-787)', () => {
  test.each(Object.entries(CURRENTLY_OPEN))('en maps %s', (key, value) => {
    expect(en[key as keyof typeof en]).toBe(value);
  });

  test('no en value still says "Open now"', () => {
    expect(Object.values(en).filter((v) => v.includes('Open now'))).toEqual([]);
  });

  // The other 12 already said "open tabs" and are untouched.
  test.each(Object.keys(LOCALES).filter((l) => l !== 'en'))(
    '%s keeps its own name',
    (lang) => {
      for (const [key, value] of Object.entries(CURRENTLY_OPEN)) {
        expect(LOCALES[lang][key]).toEqual(expect.any(String));
        expect(LOCALES[lang][key]).not.toBe(value);
      }
    }
  );
});
