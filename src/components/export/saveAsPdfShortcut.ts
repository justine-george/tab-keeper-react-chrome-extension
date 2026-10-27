type ShortcutKey = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'getModifierState'
>;

/**
 * KAN-826. ⌘P and ⌘S (Ctrl off the Mac), with Shift or Alt too: on the export
 * page they would print or save the page around the file.
 *
 * The letter is the one on the key's cap, so Dvorak's P is P. Only where the
 * key is not a Latin letter -- a Russian layout, or ⌥ turning P into π -- does
 * the key's position decide, as Chrome's own shortcut does there. Ctrl on a Mac
 * is left alone: in a text field Ctrl+P is the Emacs "previous line". So is
 * AltGr, which Windows reports as Ctrl: AltGr+S types ś or ș. Until Chrome
 * says which platform this is, either modifier counts.
 */
export function isSaveAsPdfShortcut(
  e: ShortcutKey,
  isMac: boolean | null
): boolean {
  const modifier =
    isMac === null ? e.metaKey || e.ctrlKey : isMac ? e.metaKey : e.ctrlKey;
  if (!modifier || e.getModifierState('AltGraph')) return false;
  const key = e.key.toLowerCase();
  const letter = /^[a-z]$/.test(key)
    ? key
    : e.code === 'KeyP'
      ? 'p'
      : e.code === 'KeyS'
        ? 's'
        : null;
  return letter === 'p' || letter === 's';
}
