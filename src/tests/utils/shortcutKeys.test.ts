import { describe, expect, test } from 'vitest';

import { shortcutKeys } from '../../utils/functions/shortcutKeys';

// KAN-256. Chrome reports a binding as one string, and its shape depends on
// the platform: "Alt+Shift+K" on Windows and Linux, "⌥⇧K" on a Mac (each
// modifier a single glyph, no separator). Keycaps need one key per cap, so
// the split has to know both shapes -- and a naive split on "+" would render
// the Mac form as a single cap reading "⌥⇧K".
describe('shortcutKeys', () => {
  test('splits the plus-joined form into its keys', () => {
    expect(shortcutKeys('Alt+Shift+K')).toEqual(['Alt', 'Shift', 'K']);
    expect(shortcutKeys('Ctrl+Shift+Y')).toEqual(['Ctrl', 'Shift', 'Y']);
  });

  test('splits the Mac glyph form one glyph per cap', () => {
    expect(shortcutKeys('⌥⇧K')).toEqual(['⌥', '⇧', 'K']);
    expect(shortcutKeys('⌘K')).toEqual(['⌘', 'K']);
  });

  test('keeps a multi-character key together in either form', () => {
    expect(shortcutKeys('Ctrl+Space')).toEqual(['Ctrl', 'Space']);
    expect(shortcutKeys('⌘F1')).toEqual(['⌘', 'F1']);
    expect(shortcutKeys('MediaPlayPause')).toEqual(['MediaPlayPause']);
  });

  test('an unset binding has no keys', () => {
    expect(shortcutKeys('')).toEqual([]);
  });
});
