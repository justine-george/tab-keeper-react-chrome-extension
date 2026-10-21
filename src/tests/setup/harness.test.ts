import { describe, it, expect, vi } from 'vitest';
import { stubDomGlobals } from './domStub';

// Inlined rather than calling stubDomGlobals(): a vi.hoisted block runs before
// the module graph is evaluated, so it cannot depend on an ES import, and
// `require` is not available under Vite's ESM transform. Keep in step with
// domStub.ts.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import { makeTestStore } from './makeStore';
import { setTimeFormat } from '../../redux/slices/settingsDataStateSlice';
import { Theme } from '../../utils/constants/theme';

describe('test harness', () => {
  it('stubs window.screen so slices can be imported', () => {
    stubDomGlobals();
    expect(
      (globalThis as unknown as { window: { screen: { height: number } } })
        .window.screen.height
    ).toBe(1080);
  });

  it('builds a store with the real middleware', () => {
    const { store } = makeTestStore();
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
  });

  // KAN-731. Its seed is not a load, so the Chalk move must not touch it.
  it('is a user on Paper who stays on Paper', async () => {
    localStorage.clear();
    const { store } = makeTestStore();
    expect(store.getState().settingsDataState.theme).toBe(Theme.LIGHT);
    store.dispatch(setTimeFormat('h23'));
    vi.resetModules();
    const { initialState } =
      await import('../../redux/slices/settingsDataStateSlice');
    expect(initialState.theme).toBe(Theme.LIGHT);
    localStorage.clear();
  });
});
