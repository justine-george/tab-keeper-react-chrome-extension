import { describe, expect, it } from 'vitest';

// KAN-955. The two skip settings say when they apply; the old names are gone from every locale.
const SAVING = 'Skip duplicates when saving';
const OPENING = 'Skip duplicates when opening';
const OLD = ['Skip duplicate tabs', 'Skip tabs already open'];

const files = import.meta.glob<Record<string, string>>(
  '/public/locales/*/translation.json',
  { import: 'default', eager: true }
);

describe('skip setting names (KAN-955)', () => {
  it('reads all 13 locales', () => {
    expect(Object.keys(files)).toHaveLength(13);
  });

  it('en names the action each setting covers', () => {
    const en = files['/public/locales/en/translation.json'];
    expect(en[SAVING]).toBe(SAVING);
    expect(en[OPENING]).toBe(OPENING);
  });

  it('every locale has both names, different from each other, and no old key', () => {
    const problems: string[] = [];
    for (const [file, json] of Object.entries(files)) {
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
