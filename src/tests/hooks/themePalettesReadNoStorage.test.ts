import { afterEach, describe, expect, it, vi } from 'vitest';

// KAN-370. e2e specs import the palettes into Node, which has no localStorage:
// loading them must not load the settings slice, which reads storage on import.

const settingsReads = () => {
  const getItem = vi.spyOn(localStorage, 'getItem');
  return {
    count: () =>
      getItem.mock.calls.filter(([k]) => k === 'settingsData').length,
    restore: () => getItem.mockRestore(),
  };
};

let reads: ReturnType<typeof settingsReads> | undefined;

afterEach(() => {
  reads?.restore();
  reads = undefined;
});

describe('theme palettes', () => {
  it('load without reading stored settings', async () => {
    vi.resetModules();
    reads = settingsReads();
    const { LIGHT_THEME } = await import('../../hooks/useThemeColors');
    expect(LIGHT_THEME).toBeDefined();
    expect(reads.count()).toBe(0);
  });

  it('control: the settings slice does read them on load', async () => {
    vi.resetModules();
    reads = settingsReads();
    await import('../../redux/slices/settingsDataStateSlice');
    expect(reads.count()).toBeGreaterThan(0);
  });
});
