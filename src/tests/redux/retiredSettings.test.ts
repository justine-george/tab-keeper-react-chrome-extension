import { afterEach, describe, expect, it, vi } from 'vitest';

// KAN-515. Keys only pre-release builds wrote: dropped on load, and written back without.

const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};
const saved = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

afterEach(() => {
  localStorage.clear();
});

describe('retired settings', () => {
  it('a saved isUiSoundOn is dropped from the state and from storage; the rest stays', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ theme: 'Blue', isUiSoundOn: false })
    );
    const { initialState } = await freshSlice();
    expect(initialState).not.toHaveProperty('isUiSoundOn');
    expect(initialState.theme).toBe('Blue');
    expect(saved()).toEqual({ theme: 'Blue' });
  });

  // KAN-732. Shipped since 1.6.0; it only unlocked the offer's "Don't ask again".
  it('a saved isTabGroupsPromptAnsweredOnce is dropped from the state and from storage; the rest stays', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ theme: 'Blue', isTabGroupsPromptAnsweredOnce: true })
    );
    const { initialState } = await freshSlice();
    expect(initialState).not.toHaveProperty('isTabGroupsPromptAnsweredOnce');
    expect(initialState.theme).toBe('Blue');
    expect(saved()).toEqual({ theme: 'Blue' });
  });
});
