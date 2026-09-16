import { beforeEach, describe, expect, test } from 'vitest';

import reducer, {
  setExportLayout,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import * as settingsSlice from '../../redux/slices/settingsDataStateSlice';

// KAN-190. The exported file has two layouts, and the switch lives on the
// export preview page rather than in Settings -- there you can see what it
// does. "Remembered as your default" is the whole contract of that switch, and
// this is what holds it: the choice has to reach localStorage, because the
// preview page is a separate page that boots its own store from there.
//
// Comfortable is the default. A user who never touches the switch gets the
// reading layout.

const stored = (): Partial<SettingsData> =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

describe('the export layout preference (KAN-190)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // KAN-212 flipped this from comfortable. The comfortable file spends a lot of
  // page on air, and the common reason to export is to send a list rather than
  // to print a document, so the denser one is the better first answer.
  //
  // Safe as a default change because export shipped after the v1.8.0 tag:
  // nobody has an exportLayout stored, so no saved choice is overridden. A
  // stored value still wins -- that is the next test.
  test('a session that was never exported defaults to the compact layout', () => {
    const state = reducer(undefined, { type: '@@INIT' });

    expect(state.exportLayout).toBe('compact');
  });

  // Chooses the layout that is NOT the default, so the write is a real change.
  // This used to choose compact, which KAN-212 made the default -- setting the
  // value the reducer already holds proves nothing about persisting a choice.
  test('choosing comfortable persists it, so the next popup and page agree', () => {
    const initial = reducer(undefined, { type: '@@INIT' });

    const next = reducer(initial, setExportLayout('comfortable'));

    expect(next.exportLayout).toBe('comfortable');
    expect(
      stored().exportLayout,
      'the preview page boots from localStorage, not from the popup in memory'
    ).toBe('comfortable');
  });

  test('switching back to the default persists too', () => {
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(state, setExportLayout('comfortable'));

    state = reducer(state, setExportLayout('compact'));

    // Written, not merely absent: returning to the default must STORE it, or
    // the next boot reads no value and falls back to the default by accident
    // -- which would look identical today and stop being identical the moment
    // the default moves again.
    expect(state.exportLayout).toBe('compact');
    expect(stored().exportLayout).toBe('compact');
  });
});

// KAN-198. The export page's Light/Dark used to be a saved setting
// (exportScheme), so a choice made once, for one export, overrode a dark
// theme on every later export, with no control to undo it. It is now the
// page's own state: the page opens on the theme's polarity and nothing it
// does is written to settings. So there is no such setting to store.
describe('the export page Light/Dark is not a setting (KAN-198)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('settings carry no export colour scheme', () => {
    const state = reducer(undefined, { type: '@@INIT' });

    expect(Object.keys(state)).not.toContain('exportScheme');
  });

  test('there is no action that could store one', () => {
    expect(Object.keys(settingsSlice)).not.toContain('setExportScheme');
  });
});
