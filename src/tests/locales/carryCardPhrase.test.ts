import { describe, expect, test } from 'vitest';

import { localeDicts, tFor } from '../setup/localeT';

// KAN-350. The carry card names a group or a window and counts its tabs in one
// phrase per locale ("Research · 2 Tabs"), not words joined in code. Its count
// half must read exactly as the locale's own TabCount does, plural form and
// counter word included -- 1, 2 and 5 reach one, few and many in Russian.

describe('the carry card phrase in every locale', () => {
  test.each(localeDicts.map(([lng]) => lng))('%s', async (lng) => {
    const t = await tFor(lng);
    for (const count of [1, 2, 5]) {
      expect(t('CarryCardNameAndCount', { name: 'Kyoto', count })).toBe(
        'Kyoto · ' + t('TabCount', { count })
      );
    }
  });

  test('all 13 locales are here', () => {
    expect(localeDicts).toHaveLength(13);
  });
});
