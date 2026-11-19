import { describe, expect, test } from 'vitest';

import { localeDicts } from '../setup/localeT';

// KAN-635. A wrap beside ⋮ strands it at a line end ("…in the ⋮ / menu."):
// a space beside it is no-break, and a hyphen after it is held by a word joiner.

const KEY =
  'Used by the save button and the Enter key. The other save is in the ⋮ menu.';

describe('the Default save help line keeps ⋮ with its word', () => {
  test('in every locale', () => {
    for (const [file, strings] of localeDicts) {
      const value = strings[KEY];
      expect(value, file).toContain('⋮');
      // A plain space breaks; U+00A0 does not.
      expect(value, file).not.toMatch(/ ⋮|⋮ /);
      expect(value, file).not.toMatch(/⋮-(?!\u2060)/);
    }
  });
});
