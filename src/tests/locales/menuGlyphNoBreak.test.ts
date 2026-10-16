import { describe, expect, test } from 'vitest';

// KAN-635. A wrap beside ⋮ strands it at a line end ("…in the ⋮ / menu."):
// a space beside it is no-break, and a hyphen after it is held by a word joiner.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const KEY =
  'Used by the save button and the Enter key. The other save is in the ⋮ menu.';

describe('the Default save help line keeps ⋮ with its word', () => {
  test('in every locale', () => {
    const entries = Object.entries(localeFiles);
    // CONTROL: the glob found all 13 locales, so an empty loop cannot pass.
    expect(entries).toHaveLength(13);

    for (const [file, strings] of entries) {
      const value = strings[KEY];
      expect(value, file).toContain('⋮');
      // A plain space breaks; U+00A0 does not.
      expect(value, file).not.toMatch(/ ⋮|⋮ /);
      expect(value, file).not.toMatch(/⋮-(?!\u2060)/);
    }
  });
});
