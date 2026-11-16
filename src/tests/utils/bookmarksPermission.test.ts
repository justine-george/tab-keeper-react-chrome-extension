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
  hasBookmarksPermission,
  removeBookmarksPermission,
  requestBookmarksPermission,
} from '../../utils/functions/permissions';

// KAN-862.
describe('bookmarks permission', () => {
  const original = globalThis.chrome;

  // chrome.permissions' overloads (callback or promise) make vi.mocked pick
  // the callback form, so the promise form is typed here instead.
  type Call = (p: chrome.permissions.Permissions) => Promise<boolean>;
  let contains: Mock<Call>;
  let request: Mock<Call>;
  let remove: Mock<Call>;

  beforeEach(() => {
    contains = vi.fn<Call>();
    request = vi.fn<Call>();
    remove = vi.fn<Call>();
    vi.stubGlobal('chrome', { permissions: { contains, request, remove } });
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

  it('has reflects contains', async () => {
    contains.mockResolvedValue(true);
    await expect(hasBookmarksPermission()).resolves.toBe(true);
    expect(contains).toHaveBeenCalledWith({
      permissions: ['bookmarks'],
    });
  });

  it('has is false when contains rejects', async () => {
    contains.mockRejectedValue(new Error('x'));
    await expect(hasBookmarksPermission()).resolves.toBe(false);
  });

  it('has is false when chrome.permissions is undefined', async () => {
    vi.stubGlobal('chrome', {});
    await expect(hasBookmarksPermission()).resolves.toBe(false);
    await expect(requestBookmarksPermission()).resolves.toBe(false);
    await expect(removeBookmarksPermission()).resolves.toBeUndefined();
  });
});
