import { afterEach, describe, expect, test, vi } from 'vitest';

// KAN-642. The worker imports this module, and the worker has no localStorage.

describe('languages', () => {
  let getItem: ReturnType<typeof vi.spyOn> | undefined;
  afterEach(() => {
    getItem?.mockRestore();
    getItem = undefined;
  });

  test('loading it reads no storage', async () => {
    vi.resetModules();
    // The unit project's localStorage is vitest-localstorage-mock, not a real Storage.
    getItem = vi.spyOn(localStorage, 'getItem');
    await import('../../../utils/functions/languages');
    expect(getItem).not.toHaveBeenCalled();
  });
});
