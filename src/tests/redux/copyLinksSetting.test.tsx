import { afterEach, describe, expect, it, vi } from 'vitest';

// KAN-859. Settings → Sessions → Copy links: links only unless with headings is picked, device-local.
const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

afterEach(() => localStorage.clear());

describe('copyLinksLayout', () => {
  it('is links only for a new install', async () => {
    const { initialState } = await freshSlice();
    expect(initialState.copyLinksLayout).toBe('links-only');
  });

  it('is links only for saved settings written before it existed', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ theme: 'Blue', language: 'de' })
    );
    const { initialState } = await freshSlice();
    expect(initialState).toMatchObject({
      theme: 'Blue',
      language: 'de',
      copyLinksLayout: 'links-only',
    });
  });

  it('keeps a saved with headings', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ copyLinksLayout: 'with-headings' })
    );
    const { initialState } = await freshSlice();
    expect(initialState.copyLinksLayout).toBe('with-headings');
  });

  it.each([
    ['"With headings"'],
    ['"with_headings"'],
    ['true'],
    ['null'],
    ['1'],
  ])('reads a malformed saved value (%s) as links only', async (raw) => {
    localStorage.setItem('settingsData', `{"copyLinksLayout":${raw}}`);
    const { initialState } = await freshSlice();
    expect(initialState.copyLinksLayout).toBe('links-only');
  });

  it('setCopyLinksLayout changes it and saves it', async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { setCopyLinksLayout } =
      await import('../../redux/slices/settingsDataStateSlice');
    const { store } = makeTestStore();
    store.dispatch(setCopyLinksLayout('with-headings'));
    expect(store.getState().settingsDataState.copyLinksLayout).toBe(
      'with-headings'
    );
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}')
    ).toMatchObject({ copyLinksLayout: 'with-headings' });
  });
});

describe('another page writing it', () => {
  const setup = async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { applyOtherPageSettings } =
      await import('../../redux/otherPageChanges');
    const { setCopyLinksLayout } =
      await import('../../redux/slices/settingsDataStateSlice');
    return { ...makeTestStore(), applyOtherPageSettings, setCopyLinksLayout };
  };

  it('takes with headings', async () => {
    const { store, applyOtherPageSettings } = await setup();
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...store.getState().settingsDataState,
        copyLinksLayout: 'with-headings',
      })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState.copyLinksLayout).toBe(
      'with-headings'
    );
  });

  it('writing settings without it, while this page is with headings, keeps with headings', async () => {
    const { store, applyOtherPageSettings, setCopyLinksLayout } = await setup();
    store.dispatch(setCopyLinksLayout('with-headings'));
    const older = Object.fromEntries(
      Object.entries(store.getState().settingsDataState).filter(
        ([key]) => key !== 'copyLinksLayout'
      )
    );
    // PREMISE: the write differs from this page only in the theme, and lacks the key.
    expect(store.getState().settingsDataState.theme).not.toBe('Blue');
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ ...older, theme: 'Blue' })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState).toMatchObject({
      theme: 'Blue',
      copyLinksLayout: 'with-headings',
    });
  });

  it('reads a malformed value as links only', async () => {
    const { store, applyOtherPageSettings, setCopyLinksLayout } = await setup();
    store.dispatch(setCopyLinksLayout('with-headings'));
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...store.getState().settingsDataState,
        copyLinksLayout: 'With headings',
      })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState.copyLinksLayout).toBe(
      'links-only'
    );
  });
});
