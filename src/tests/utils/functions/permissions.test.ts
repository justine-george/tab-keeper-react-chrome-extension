import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  setupChromeFake,
  type ChromeFakeHandle,
} from '../../setup/chrome.fake';
import {
  hasTabGroupsPermission,
  observeTabGroupsPermission,
  removeTabGroupsPermission,
  requestTabGroupsPermission,
  hasSessionsPermission,
  askForSessionsPermission,
  SESSIONS_ANSWER_WAIT_MS,
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

  // The other half of the same guard: a tabGroups observer must not fire for
  // a `sessions` change either, now that both permissions share this file.
  test('a sessions change does not report a tabGroups change', async () => {
    handle = setupChromeFake();
    const seen: boolean[] = [];
    observeTabGroupsPermission((granted) => seen.push(granted));

    await askForSessionsPermission();
    await chrome.permissions.remove({ permissions: ['sessions'] });

    expect(seen).toEqual([]);
  });
});

describe('hasSessionsPermission', () => {
  test('false on a profile that has not granted it', async () => {
    handle = setupChromeFake();
    expect(await hasSessionsPermission()).toBe(false);
  });

  test('true once granted', async () => {
    handle = setupChromeFake({ grantedPermissions: ['sessions'] });
    expect(await hasSessionsPermission()).toBe(true);
  });

  // Reflect.deleteProperty rather than the cast-and-`!`-assert `delete
  // (globalThis as {...}).chrome!.permissions` idiom the tabGroups test above
  // uses: `chrome.permissions` is typed as always present, so a plain `delete`
  // needs a cast to make it optional first. Reflect.deleteProperty's target
  // parameter is just `object`, which `chrome` already satisfies with no
  // widening, and it drops the property with no non-null assertion needed.
  test('false, not a throw, when the API is missing entirely', async () => {
    handle = setupChromeFake();
    Reflect.deleteProperty(chrome, 'permissions');
    await expect(hasSessionsPermission()).resolves.toBe(false);
  });
});

// KAN-663. No setting: a close in Open now asks, inside its gesture, and
// waits for the answer -- but never longer than SESSIONS_ANSWER_WAIT_MS.
describe('askForSessionsPermission', () => {
  test('asks at once, before anything awaits, and resolves true once granted', async () => {
    handle = setupChromeFake();
    const request = vi.spyOn(chrome.permissions, 'request');

    const answer = askForSessionsPermission();
    // Called synchronously: an await before it would leave the gesture.
    expect(request).toHaveBeenCalledWith({ permissions: ['sessions'] });

    expect(await answer).toBe(true);
    expect(await hasSessionsPermission()).toBe(true);
  });

  test('already held: asks anyway and resolves true', async () => {
    handle = setupChromeFake({ grantedPermissions: ['sessions'] });
    expect(await askForSessionsPermission()).toBe(true);
  });

  test('refused: false, and nothing is granted', async () => {
    handle = setupChromeFake({ refusedPermissions: ['sessions'] });
    expect(await askForSessionsPermission()).toBe(false);
    expect(await hasSessionsPermission()).toBe(false);
  });

  test('a rejection is false, never a throw or an unhandled rejection', async () => {
    handle = setupChromeFake();
    Reflect.set(chrome.permissions, 'request', () =>
      Promise.reject(new Error('user gesture required'))
    );
    let sawUnhandledRejection = false;
    const onUnhandledRejection = () => {
      sawUnhandledRejection = true;
    };
    process.once('unhandledRejection', onUnhandledRejection);

    expect(await askForSessionsPermission()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.removeListener('unhandledRejection', onUnhandledRejection);
    expect(sawUnhandledRejection).toBe(false);
  });

  test('a synchronous throw is false', async () => {
    handle = setupChromeFake();
    Reflect.set(chrome.permissions, 'request', () => {
      throw new Error(
        'Only permissions specified in the manifest may be requested.'
      );
    });
    expect(await askForSessionsPermission()).toBe(false);
  });

  test('false, not a throw, when the API is missing entirely', async () => {
    handle = setupChromeFake();
    Reflect.deleteProperty(chrome, 'permissions');
    expect(await askForSessionsPermission()).toBe(false);
  });

  test('an answer that never comes is false after the wait, not before', async () => {
    vi.useFakeTimers();
    try {
      handle = setupChromeFake({ requestNeverSettles: true });
      let settled: boolean | undefined;
      void askForSessionsPermission().then((value) => {
        settled = value;
      });

      await vi.advanceTimersByTimeAsync(SESSIONS_ANSWER_WAIT_MS - 1);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
