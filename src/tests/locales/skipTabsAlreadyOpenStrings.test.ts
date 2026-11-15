import { describe, expect, it } from 'vitest';

// KAN-910. The setting's label and help, the two toasts, and the reworded Skip duplicates when saving help.
const NEW_KEYS = [
  'Skip duplicates when opening',
  'Opening or dropping saved tabs into a window that’s already open leaves out pages it already has.',
  'This window already has this tab.',
  'This window already has these tabs.',
  'When you add or move a window or tabs to a saved session, pages it already has are left out, and a new session keeps one copy of each.',
];
const OLD_KEY =
  'When you add a window or tabs to a saved session, pages it already has are left out, and a new session keeps one copy of each.';

const files = import.meta.glob<Record<string, string>>(
  '/public/locales/*/translation.json',
  { import: 'default', eager: true }
);

describe('Skip duplicates when opening strings', () => {
  it('reads all 13 locales', () => {
    expect(Object.keys(files)).toHaveLength(13);
  });

  it('every locale has the five new keys, non-empty, and not the old help key', () => {
    const problems: string[] = [];
    for (const [file, json] of Object.entries(files)) {
      for (const key of NEW_KEYS)
        if (!json[key]?.trim()) problems.push(`${file}: missing "${key}"`);
      if (OLD_KEY in json) problems.push(`${file}: still has the old help key`);
    }
    expect(problems).toEqual([]);
  });
});
