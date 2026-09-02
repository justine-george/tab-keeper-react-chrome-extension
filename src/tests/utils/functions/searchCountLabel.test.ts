import { describe, expect, test } from 'vitest';

import en from '../../../../public/locales/en/translation.json';
import {
  formatGroupCounts,
  isSearchActive,
} from '../../../utils/functions/local';

// The real en values, looked up the way i18next would but without i18next --
// this file is about the SHAPE of the string (where the prefix goes, which
// noun is picked) and stays a pure unit test. Resolving against the real
// locale rather than echoing keys matters because the two differ: the key is
// 'Matches' and the value is 'Matches:'. What the OTHER nine locales say is
// asserted on their values in src/tests/locales/searchLabel.test.ts.
const strings = en as Record<string, string>;
const t = (key: string) => strings[key] ?? key;

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
    expect(formatGroupCounts(7, 13, false, t)).toBe('7 Windows - 13 Tabs');
  });

  test('says the counts are matches when a filter is active', () => {
    expect(formatGroupCounts(1, 1, true, t)).toBe('Matches: 1 Window - 1 Tab');
  });

  test('keeps the prefix off the plural form too', () => {
    expect(formatGroupCounts(3, 5, false, t)).toBe('3 Windows - 5 Tabs');
  });

  test('keeps the prefix on the plural form too', () => {
    expect(formatGroupCounts(3, 5, true, t)).toBe(
      'Matches: 3 Windows - 5 Tabs'
    );
  });

  test('picks singular and plural independently', () => {
    expect(formatGroupCounts(1, 9, false, t)).toBe('1 Window - 9 Tabs');
    expect(formatGroupCounts(9, 1, false, t)).toBe('9 Windows - 1 Tab');
  });

  // Characterisation, not endorsement. `count > 1` sends zero to the singular,
  // so a hypothetical empty group would read "0 Window". Both render sites did
  // this before this helper existed and neither can reach it -- a saved
  // session always holds a window, and filterTabGroups only emits groups with
  // at least one matched window. Pinned so the extraction is provably a
  // refactor; fixing it is a separate change.
  test('preserves the pre-existing zero-is-singular behaviour', () => {
    expect(formatGroupCounts(0, 0, false, t)).toBe('0 Window - 0 Tab');
  });
});
