import { afterEach, describe, expect, test } from 'vitest';

import {
  setupChromeFake,
  type ChromeFakeHandle,
} from '../../setup/chrome.fake';
import {
  hasTabGroupsPermission,
  observeTabGroupsPermission,
  removeTabGroupsPermission,
  requestTabGroupsPermission,
} from '../../../utils/functions/permissions';

let handle: ChromeFakeHandle;
afterEach(() => handle?.restore());

describe('hasTabGroupsPermission', () => {
  test('false on a profile that has not granted it', async () => {
    handle = setupChromeFake();
    expect(await hasTabGroupsPermission()).toBe(false);
  });

  test('true once granted', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });
    expect(await hasTabGroupsPermission()).toBe(true);
  });

  test('false, not a throw, when the API is missing entirely', async () => {
    handle = setupChromeFake();
    delete (globalThis as { chrome?: { permissions?: unknown } }).chrome!
      .permissions;
    await expect(hasTabGroupsPermission()).resolves.toBe(false);
  });
});

describe('requestTabGroupsPermission', () => {
  // The whole point. The measured production behaviour is that the popup may
  // be destroyed before the promise settles, so this function returns void and
  // callers learn the outcome from contains() or from the change listener.
  test('returns undefined rather than a promise', () => {
    handle = setupChromeFake();
    expect(requestTabGroupsPermission()).toBeUndefined();
  });

  // This only proves the synchronous call doesn't throw. It cannot exercise
  // the implementation's .catch(), because requestNeverSettles's promise never
  // settles at all (it neither resolves nor rejects) -- see the dedicated
  // rejection test below for that.
  test('does not throw synchronously when the request never settles', async () => {
    handle = setupChromeFake({ requestNeverSettles: true });
    expect(() => requestTabGroupsPermission()).not.toThrow();
    await Promise.resolve();
  });

  // The real target of the "errors are swallowed" comment in the
  // implementation. requestNeverSettles models a promise that hangs forever,
  // which can never reach a .catch(); a genuine rejection needs a fake that
  // actually rejects, so this overrides chrome.permissions.request on the
  // already-installed fake rather than adding a seed to chrome.fake.ts.
  test('swallows a rejection from chrome.permissions.request', async () => {
    handle = setupChromeFake();
    const permissions = chrome.permissions as unknown as {
      request: () => Promise<boolean>;
    };
    permissions.request = () =>
      Promise.reject(new Error('user gesture required'));

    expect(() => requestTabGroupsPermission()).not.toThrow();
    // Let the rejection settle. If the implementation's .catch is removed,
    // this surfaces as an unhandled rejection rather than a silent no-op.
    await Promise.resolve();
    await Promise.resolve();
  });

  test('the grant is observable through contains()', async () => {
    handle = setupChromeFake();
    requestTabGroupsPermission();
    await Promise.resolve();
    expect(await hasTabGroupsPermission()).toBe(true);
  });
});

describe('observeTabGroupsPermission', () => {
  test('reports both a grant and a revocation', async () => {
    handle = setupChromeFake();
    const seen: boolean[] = [];
    observeTabGroupsPermission((granted) => seen.push(granted));

    requestTabGroupsPermission();
    await Promise.resolve();
    removeTabGroupsPermission();
    await Promise.resolve();

    expect(seen).toEqual([true, false]);
  });
});
