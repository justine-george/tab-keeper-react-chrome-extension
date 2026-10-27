import { describe, expect, test } from 'vitest';

import { isSaveAsPdfShortcut } from '../../components/export/saveAsPdfShortcut';

const press = (
  key: string,
  code: string,
  mods: { meta?: boolean; ctrl?: boolean; altGraph?: boolean } = {}
) => ({
  key,
  code,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  getModifierState: (name: string) =>
    name === 'AltGraph' && (mods.altGraph ?? false),
});

describe('isSaveAsPdfShortcut (KAN-826)', () => {
  test.each([
    ['⌘P', press('p', 'KeyP', { meta: true })],
    ['⇧⌘P', press('P', 'KeyP', { meta: true })],
    // ⌥ turns the key into π; the code still says P.
    ['⌥⌘P', press('π', 'KeyP', { meta: true })],
    ['⌘S', press('s', 'KeyS', { meta: true })],
    // Russian layout: the key is a Cyrillic letter, the code the P cap.
    ['⌘З on a Russian layout', press('з', 'KeyP', { meta: true })],
    // Dvorak: the key printed on the cap wins over its position.
    ['⌘P on Dvorak', press('p', 'KeyR', { meta: true })],
  ])('on a Mac, %s is taken', (_name, e) => {
    expect(isSaveAsPdfShortcut(e, true)).toBe(true);
  });

  test.each([
    // Emacs keys in a text field: Ctrl+P is "previous line" on a Mac.
    ['Ctrl+P', press('p', 'KeyP', { ctrl: true })],
    ['a plain P', press('p', 'KeyP')],
    ['⌘L', press('l', 'KeyL', { meta: true })],
    // Dvorak: the P position carries L, and ⌘L is the address bar.
    ['⌘L on Dvorak', press('l', 'KeyP', { meta: true })],
  ])('on a Mac, %s is left alone', (_name, e) => {
    expect(isSaveAsPdfShortcut(e, true)).toBe(false);
  });

  test.each([
    ['Ctrl+P', press('p', 'KeyP', { ctrl: true }), true],
    ['Ctrl+Shift+P', press('P', 'KeyP', { ctrl: true }), true],
    ['Ctrl+S', press('s', 'KeyS', { ctrl: true }), true],
    ['Ctrl+З on a Russian layout', press('з', 'KeyP', { ctrl: true }), true],
    ['Meta+P', press('p', 'KeyP', { meta: true }), false],
  ])('elsewhere, %s is taken: %s', (_name, e, taken) => {
    expect(isSaveAsPdfShortcut(e, false)).toBe(taken);
  });

  // Windows reports AltGr as Ctrl (and Alt): AltGr+S types ś on a Polish
  // layout, ș on a Romanian one. Chrome's Ctrl+S does not fire, and the letter
  // must reach the field.
  test.each([
    ['ś (Polish)', press('ś', 'KeyS', { ctrl: true, altGraph: true })],
    ['ș (Romanian)', press('ș', 'KeyS', { ctrl: true, altGraph: true })],
    ['AltGr+P', press('π', 'KeyP', { ctrl: true, altGraph: true })],
  ])('elsewhere, AltGr typing %s is left alone', (_name, e) => {
    expect(isSaveAsPdfShortcut(e, false)).toBe(false);
    expect(isSaveAsPdfShortcut(e, null)).toBe(false);
  });

  // Before Chrome says which platform this is, either modifier counts.
  test.each([
    ['⌘P', press('p', 'KeyP', { meta: true })],
    ['Ctrl+P', press('p', 'KeyP', { ctrl: true })],
  ])('with the platform unknown, %s is taken', (_name, e) => {
    expect(isSaveAsPdfShortcut(e, null)).toBe(true);
  });

  // CONTROL: unknown platform does not mean every key.
  test('with the platform unknown, a plain P is left alone', () => {
    expect(isSaveAsPdfShortcut(press('p', 'KeyP'), null)).toBe(false);
  });
});
