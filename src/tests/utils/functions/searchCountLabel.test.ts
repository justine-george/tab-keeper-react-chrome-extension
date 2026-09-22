import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, test } from 'vitest';

import { tFor } from '../../setup/localeT';
import {
  formatGroupCounts,
  isSearchActive,
} from '../../../utils/functions/local';

// Real en i18n. This file is about the SHAPE of the string (where the prefix
// goes, which form is picked), and since KAN-286 the form is chosen by
// i18next's plural rules, so a hand-rolled lookup can no longer stand in.
// Resolving real values matters too: the key is 'Matches' and the value is
// 'Matches:'. What the other locales say is in src/tests/locales/.
let t: TFunction;
beforeAll(async () => {
  t = await tFor('en');
});

describe('isSearchActive', () => {
  test('is true only when the panel is open AND something has been typed', () => {
    expect(isSearchActive(true, 'kagi')).toBe(true);
  });

  // The case that makes this a predicate rather than a boolean read.
  // filterTabGroups never runs on an empty box, so the counts on screen are
  // the session's real size -- labelling them as matches would be a new lie in
  // the opposite direction to the one KAN-60 fixes.
  test('is false when the panel is open but the box is empty', () => {
    expect(isSearchActive(true, '')).toBe(false);
  });

  test('is false when nothing is typed and the panel is closed', () => {
    expect(isSearchActive(false, '')).toBe(false);
  });

  // Stale text outliving a closed panel: the list is not filtered, so the
  // counts are real.
  test('is false when the panel is closed even if text lingers', () => {
    expect(isSearchActive(false, 'kagi')).toBe(false);
  });
});

describe('formatGroupCounts', () => {
  test('describes the session itself when no filter is active', () => {
    expect(formatGroupCounts(7, 13, false, t)).toBe('7 Windows · 13 Tabs');
  });

  test('says the counts are matches when a filter is active', () => {
    expect(formatGroupCounts(1, 1, true, t)).toBe('Matches: 1 Window · 1 Tab');
  });

  test('keeps the prefix off the plural form too', () => {
    expect(formatGroupCounts(3, 5, false, t)).toBe('3 Windows · 5 Tabs');
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
