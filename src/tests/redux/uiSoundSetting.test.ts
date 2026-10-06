import { afterEach, describe, expect, it, vi } from 'vitest';

// Settings → Sounds: on for a new install and for a user whose saved settings predate it.

const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};
const saved = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

afterEach(() => {
  localStorage.clear();
});

describe('isUiSoundOn', () => {
  it('is on for a new install', async () => {
    const { initialState } = await freshSlice();
    expect(initialState.isUiSoundOn).toBe(true);
  });

  it('is on for saved settings written before it existed', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ theme: 'Blue', isAutoSync: false })
    );
    const { initialState } = await freshSlice();
    expect(initialState).toMatchObject({ theme: 'Blue', isUiSoundOn: true });
  });

  it('keeps a saved Off', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ isUiSoundOn: false })
    );
    const { initialState } = await freshSlice();
    expect(initialState.isUiSoundOn).toBe(false);
  });

  it('setUiSoundOn sets it and saves it', async () => {
    const { settingsDataStateSlice, setUiSoundOn } = await freshSlice();
    const off = settingsDataStateSlice.reducer(undefined, setUiSoundOn(false));
    expect(off.isUiSoundOn).toBe(false);
    expect(saved()).toMatchObject({ isUiSoundOn: false });
    const on = settingsDataStateSlice.reducer(off, setUiSoundOn(true));
    expect(on.isUiSoundOn).toBe(true);
    expect(saved()).toMatchObject({ isUiSoundOn: true });
  });
});
