import { beforeEach, describe, expect, test } from 'vitest';

import reducer, {
  setExportLayout,
  setExportScheme,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';

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

// KAN-190. The file's polarity follows the Tab Keeper theme by default, which
// is what a Light-theme user expects. But the person exporting knows things
// the theme does not: a dark document to print, or a light one to send to a
// colleague. So the preview offers Light and Dark, and the choice sticks.
//
// 'auto' is its own value rather than a null: "follow my theme" is a real
// answer, and a user who never touches the switch keeps it when they change
// theme.
describe('the export colour scheme preference (KAN-190)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('a user who never chose follows their theme', () => {
    const state = reducer(undefined, { type: '@@INIT' });

    expect(state.exportScheme).toBe('auto');
  });

  test('choosing dark persists it', () => {
    const initial = reducer(undefined, { type: '@@INIT' });

    const next = reducer(initial, setExportScheme('dark'));

    expect(next.exportScheme).toBe('dark');
    expect(stored().exportScheme).toBe('dark');
  });

  test('choosing light persists it, and is not the same as following the theme', () => {
    let state = reducer(undefined, { type: '@@INIT' });

    state = reducer(state, setExportScheme('light'));

    expect(state.exportScheme).toBe('light');
    expect(stored().exportScheme).toBe('light');
  });
});
