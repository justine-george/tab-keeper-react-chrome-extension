import { beforeEach, describe, expect, test } from 'vitest';

import reducer, {
  setExportLayout,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';

// The choice must reach localStorage: the preview page boots its own store
// from there. Compact is the default (KAN-212).

const stored = (): Partial<SettingsData> =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

describe('the export layout preference (KAN-190)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // People export to send a list more than to print, so the denser layout is
  // the default.
  test('a session that was never exported defaults to the compact layout', () => {
    const state = reducer(undefined, { type: '@@INIT' });

    expect(state.exportLayout).toBe('compact');
  });

  // Chooses the non-default layout, so the write is a real change.
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

    // Stored, not merely absent: an absent value would follow the default if it
    // moved again.
    expect(state.exportLayout).toBe('compact');
    expect(stored().exportLayout).toBe('compact');
  });
});
