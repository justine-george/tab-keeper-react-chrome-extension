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

// This file runs under vitest's 'node' project (a plain .ts test, see
// vite.config.ts), so `process` genuinely exists at runtime -- tsconfig.json
// just omits @types/node from `types` so APP code cannot reach for Node APIs
// a browser extension does not have. This local, minimal shape is enough for
// the one test below that needs it, without pulling in the full node types.
declare const process: {
  once(event: 'unhandledRejection', listener: () => void): void;
  removeListener(event: 'unhandledRejection', listener: () => void): void;
};

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

    // Localises the assertion instead of relying on vitest's own exit code:
    // register our own listener and check whether IT fired, rather than
    // trusting the test runner to notice and fail the process for us.
    let sawUnhandledRejection = false;
    const onUnhandledRejection = () => {
      sawUnhandledRejection = true;
    };
    process.once('unhandledRejection', onUnhandledRejection);

    expect(() => requestTabGroupsPermission()).not.toThrow();
    // Node fires 'unhandledRejection' on a later tick than the microtask
    // queue -- two chained Promise.resolve() awaits were not enough for it to
    // fire and were removing the listener too early (verified: with the
    // implementation's .catch deleted, that timing let the rejection through
    // silently and this test still passed). A macrotask tick (setTimeout)
    // is enough for Node to run its check before the listener is torn down.
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.removeListener('unhandledRejection', onUnhandledRejection);
    // Mutation-tested: deleting `.catch(() => {})` from
    // requestTabGroupsPermission makes this assertion fail on its own, with
    // no unhandled-rejection noise from vitest -- see KAN-11 final fix wave.
    expect(sawUnhandledRejection).toBe(false);
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

  // Guards against the listener reporting ANY permission change as a
  // tabGroups change (it used to -- it discarded the event payload). The
  // fake's request()/remove() accept any permission name, so a change to an
  // unrelated one exercises exactly the payload the production listener must
  // now inspect before calling onChange.
  test('a change to a different permission does not report a tabGroups change', async () => {
    handle = setupChromeFake();
    const seen: boolean[] = [];
    observeTabGroupsPermission((granted) => seen.push(granted));

    const permissions = chrome.permissions as unknown as {
      request: (
        permissions: chrome.permissions.Permissions
      ) => Promise<boolean>;
      remove: (permissions: chrome.permissions.Permissions) => Promise<boolean>;
    };
    await permissions.request({ permissions: ['bookmarks'] });
    await permissions.remove({ permissions: ['bookmarks'] });

    expect(seen).toEqual([]);
  });
});
