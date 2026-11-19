import { describe, expect, it } from 'vitest';

import { dictFor, localeDicts } from '../setup/localeT';

// KAN-955. The two skip settings say when they apply; the old names are gone from every locale.
const SAVING = 'Skip duplicates when saving';
const OPENING = 'Skip duplicates when opening';
const OLD = ['Skip duplicate tabs', 'Skip tabs already open'];

describe('skip setting names (KAN-955)', () => {
  it('en names the action each setting covers', () => {
    const en = dictFor('en');
    expect(en[SAVING]).toBe(SAVING);
    expect(en[OPENING]).toBe(OPENING);
  });

  it('every locale has both names, different from each other, and no old key', () => {
    const problems: string[] = [];
    for (const [file, json] of localeDicts) {
      const saving = json[SAVING]?.trim();
      const opening = json[OPENING]?.trim();
      if (!saving) problems.push(`${file}: missing "${SAVING}"`);
      if (!opening) problems.push(`${file}: missing "${OPENING}"`);
      if (saving && saving === opening)
        problems.push(`${file}: both settings read "${saving}"`);
      for (const key of OLD)
        if (key in json) problems.push(`${file}: still has "${key}"`);
    }
    expect(problems).toEqual([]);
  });
});
