import { describe, expect, test, vi } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load. This
// test runs in the `unit` (node) project, which has no window. Every existing
// node test that touches a slice carries this same block -- see
// src/tests/redux/syncScheduling.test.ts.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import { rootReducer } from '../../redux/storeConfig';
import { store } from '../../redux/store';
import { makeTestStore } from '../setup/makeStore';

// The app store and the test store must stay in agreement. Comparing both
// against the shared map is what makes adding a slice to one but not the
// other impossible.
describe('rootReducer', () => {
  test('is the single source of the slice list', () => {
    const expected = [
      'globalState',
      'settingsCategoryState',
      'settingsDataState',
      'tabContainerDataState',
      'undoRedo',
    ];

    expect(Object.keys(rootReducer).sort()).toEqual(expected);
    expect(Object.keys(store.getState()).sort()).toEqual(expected);
    expect(Object.keys(makeTestStore().store.getState()).sort()).toEqual(
      expected
    );
  });
});
