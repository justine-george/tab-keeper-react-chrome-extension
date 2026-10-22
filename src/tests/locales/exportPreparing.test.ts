import { describe, expect, test } from 'vitest';

import { localeDicts } from '../setup/localeT';

// KAN-603. Print's face while the file's icons load. i18next answers a missing
// key with the key itself, so only reading the values sees a gap.
const KEY = 'Preparing…';

describe('the Print face while icons load (KAN-603)', () => {
  test('every locale defines it', () => {
    const missing = localeDicts
      .filter(([, dict]) => !dict[KEY])
      .map(([lang]) => lang);
    expect(missing).toEqual([]);
  });

  test('every non-English locale translates it', () => {
    const untranslated = localeDicts
      .filter(([lang, dict]) => lang !== 'en' && dict[KEY] === KEY)
      .map(([lang]) => lang);
    expect(untranslated).toEqual([]);
  });
});
