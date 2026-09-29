import { describe, expect, test } from 'vitest';

import { formatOpenNowCounts } from '../../utils/functions/local';
import { localeDicts, tFor } from '../setup/localeT';

// KAN-330. Four new phrases. i18next answers a missing key with the key
// itself, so a locale that never got a translation still renders English with
// no error; only reading the values sees it (as searchLabel.test.ts does).
const KEYS = ['Search open tabs', 'Clear search', 'NoOpenTabMatches'] as const;

describe('Open now search phrases (KAN-330)', () => {
  test('every locale defines the three plain keys', () => {
    const missing = localeDicts.flatMap(([lang, dict]) =>
      KEYS.filter((key) => !dict[key]).map((key) => `${lang}: ${key}`)
    );
    expect(missing).toEqual([]);
  });

  test('every non-English locale translates them', () => {
    const untranslated = localeDicts
      .filter(([lang]) => lang !== 'en')
      .flatMap(([lang, dict]) =>
        KEYS.filter((key) => dict[key] === key).map((key) => `${lang}: ${key}`)
      );
    expect(untranslated).toEqual([]);
  });

  test('en: the count without and with a search', async () => {
    const t = await tFor('en');
    expect(formatOpenNowCounts(3, 14, null, t)).toBe('3 Windows · 14 Tabs');
    expect(formatOpenNowCounts(3, 14, 4, t)).toBe('3 Windows · 4 of 14 Tabs');
    expect(formatOpenNowCounts(1, 1, 1, t)).toBe('1 Window · 1 of 1 Tab');
  });

  test('ru: the noun agrees with the total', async () => {
    const t = await tFor('ru');
    expect(formatOpenNowCounts(1, 21, 2, t)).toBe('1 окно · 2 из 21 вкладки');
    expect(formatOpenNowCounts(1, 3, 1, t)).toBe('1 окно · 1 из 3 вкладок');
    expect(formatOpenNowCounts(1, 5, 2, t)).toBe('1 окно · 2 из 5 вкладок');
  });

  test('the no-match line carries the text', async () => {
    const t = await tFor('en');
    expect(t('NoOpenTabMatches', { text: 'osaka' })).toBe(
      'No open tab matches "osaka"'
    );
  });
});
