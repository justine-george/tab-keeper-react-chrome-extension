import { describe, expect, test } from 'vitest';

import { selectIsSavedSessionFolded } from '../../redux/savedSessionFold';

// KAN-280 O4/O5. The tab view's grid and a saved-session click both read
// this one answer: the stored fold, unless a peek has shown the session for
// now. Every combination of the two.
describe('selectIsSavedSessionFolded', () => {
  const folded = (fold: boolean, peeking: boolean) =>
    selectIsSavedSessionFolded({
      settingsDataState: { foldSavedSessionInTabView: fold },
      globalState: { isPeekingSavedSession: peeking },
    });

  test('folded by the setting, and no peek: folded', () => {
    expect(folded(true, false)).toBe(true);
  });

  test('folded by the setting, but peeking: not folded', () => {
    expect(folded(true, true)).toBe(false);
  });

  test('side by side, and no peek: not folded', () => {
    expect(folded(false, false)).toBe(false);
  });

  test('side by side, and a leftover peek: still not folded', () => {
    expect(folded(false, true)).toBe(false);
  });
});
