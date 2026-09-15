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

  test('a session that was never exported defaults to the comfortable layout', () => {
    const state = reducer(undefined, { type: '@@INIT' });

    expect(state.exportLayout).toBe('comfortable');
  });

  test('choosing compact persists it, so the next popup and page agree', () => {
    const initial = reducer(undefined, { type: '@@INIT' });

    const next = reducer(initial, setExportLayout('compact'));

    expect(next.exportLayout).toBe('compact');
    expect(
      stored().exportLayout,
      'the preview page boots from localStorage, not from the popup in memory'
    ).toBe('compact');
  });

  test('switching back to comfortable persists too', () => {
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(state, setExportLayout('compact'));

    state = reducer(state, setExportLayout('comfortable'));

    expect(state.exportLayout).toBe('comfortable');
    expect(stored().exportLayout).toBe('comfortable');
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
