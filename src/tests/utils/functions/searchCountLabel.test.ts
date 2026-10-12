import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, test } from 'vitest';

import { tFor } from '../../setup/localeT';
import { formatGroupCounts } from '../../../utils/functions/local';

// Real en i18n. This file is about the SHAPE of the string (where the prefix
// goes, which form is picked), and since KAN-286 the form is chosen by
// i18next's plural rules, so a hand-rolled lookup can no longer stand in.
// Resolving real values matters too: the key is 'Matches' and the value is
// 'Matches:'. What the other locales say is in src/tests/locales/.
let t: TFunction;
beforeAll(async () => {
  t = await tFor('en');
});

describe('formatGroupCounts', () => {
  test('describes the session itself when no filter is active', () => {
    expect(formatGroupCounts(7, 13, false, t)).toBe('7 Windows · 13 Tabs');
  });

  test('says the counts are matches when a filter is active', () => {
    expect(formatGroupCounts(1, 1, true, t)).toBe('Matches: 1 Window · 1 Tab');
  });

  test('keeps the prefix on the plural form too', () => {
    expect(formatGroupCounts(3, 5, true, t)).toBe(
      'Matches: 3 Windows · 5 Tabs'
    );
  });

  test('picks singular and plural independently', () => {
    expect(formatGroupCounts(1, 9, false, t)).toBe('1 Window · 9 Tabs');
    expect(formatGroupCounts(9, 1, false, t)).toBe('9 Windows · 1 Tab');
  });

  // This used to pin "0 Window" as characterisation, not endorsement:
  // `count > 1` sent zero to the singular. KAN-286 is the separate change that
  // comment promised -- English plural rules put zero in "other". Neither
  // render site can reach zero (a saved session always holds a window), so no
  // user saw either form.
  test('zero is plural, per English plural rules', () => {
    expect(formatGroupCounts(0, 0, false, t)).toBe('0 Windows · 0 Tabs');
  });
});
