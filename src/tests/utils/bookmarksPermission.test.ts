import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import {
  removeBookmarksPermission,
  requestBookmarksPermission,
} from '../../utils/functions/permissions';

// KAN-862.
describe('bookmarks permission', () => {
  const original = globalThis.chrome;

  // chrome.permissions' overloads (callback or promise) make vi.mocked pick
  // the callback form, so the promise form is typed here instead.
  type Call = (p: chrome.permissions.Permissions) => Promise<boolean>;
  let request: Mock<Call>;
  let remove: Mock<Call>;

  beforeEach(() => {
    request = vi.fn<Call>();
    remove = vi.fn<Call>();
    vi.stubGlobal('chrome', { permissions: { request, remove } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.chrome = original;
  });

  it('request resolves true when Chrome grants it', async () => {
    request.mockResolvedValue(true);
    await expect(requestBookmarksPermission()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({
      permissions: ['bookmarks'],
    });
  });

  it('request resolves false when Chrome declines', async () => {
    request.mockResolvedValue(false);
    await expect(requestBookmarksPermission()).resolves.toBe(false);
  });

  it('request resolves false when the call rejects', async () => {
    request.mockRejectedValue(new Error('no'));
    await expect(requestBookmarksPermission()).resolves.toBe(false);
  });

  it('request resolves false when the call throws synchronously', async () => {
    request.mockImplementation(() => {
      throw new Error('no');
    });
    await expect(requestBookmarksPermission()).resolves.toBe(false);
  });

  it('remove asks Chrome to remove only bookmarks', async () => {
    remove.mockResolvedValue(true);
    await removeBookmarksPermission();
    expect(remove).toHaveBeenCalledWith({
      permissions: ['bookmarks'],
    });
  });

  it('remove does not throw when Chrome rejects', async () => {
    remove.mockRejectedValue(new Error('req'));
    await expect(removeBookmarksPermission()).resolves.toBeUndefined();
  });

  it('request is false and remove a no-op when chrome.permissions is undefined', async () => {
    vi.stubGlobal('chrome', {});
    await expect(requestBookmarksPermission()).resolves.toBe(false);
    await expect(removeBookmarksPermission()).resolves.toBeUndefined();
  });
});
