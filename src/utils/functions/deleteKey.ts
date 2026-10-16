// KAN-592, KAN-638. The keys that delete a session: on its focused row and in its open ⋮.

type KeyInit = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

// ⌫, Delete (fn⌫ on a Mac) and ⌘⌫, on every OS; Ctrl, Alt or Shift with it is another command.
export const isDeleteKey = (e: KeyInit): boolean =>
  (e.key === 'Backspace' || e.key === 'Delete') &&
  !e.ctrlKey &&
  !e.altKey &&
  !e.shiftKey;

// For aria-keyshortcuts. A Mac's ⌫ is Backspace and its fn⌫ Delete.
export const deleteKeyShortcutsFor = (isMac: boolean): string =>
  isMac ? 'Backspace Meta+Backspace Delete' : 'Delete Backspace';
