import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { deleteApp, getApps } from 'firebase/app';

// KAN-147. A missing Firebase config must not take the whole app down.
//
// `getAuth()` validates the key and throws `auth/invalid-api-key` during MODULE
// INITIALISATION, so with no config the import itself fails, React never
// mounts, and the popup is a blank white rectangle with no message. Measured
// from a Playwright trace: one `pageError`, and a screenshot of nothing.
//
// Cloud sync is optional in this product -- a signed-out user has a fully
// working local extension -- so a config failure should disable sync and leave
// everything else alone, the way going offline already does.
//
// RE-IMPORTED rather than merely re-rendered, and that is the whole point: the
// config is read once, at module load, to build `firebaseConfig`. Only
// resetModules plus a fresh import exercises the path that actually breaks.

const CONFIG_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MEASUREMENT_ID',
] as const;

const withConfig = () => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIzaSyTestKeyForUnitTests0000000000000');
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'unit-test.firebaseapp.com');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'unit-test');
  vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', 'unit-test.appspot.com');
  vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', '000000000000');
  vi.stubEnv('VITE_FIREBASE_APP_ID', '1:0:web:0');
  vi.stubEnv('VITE_FIREBASE_MEASUREMENT_ID', 'G-0');
};

const withoutConfig = () => {
  for (const key of CONFIG_KEYS) vi.stubEnv(key, '');
};

beforeEach(() => vi.resetModules());

// Firebase keeps its app registry in a GLOBAL that vi.resetModules does not
// touch -- it resets the ES module cache, not the state a dependency has
// already stashed. So a second initializeApp with different options throws
// `app/duplicate-app`, and the configured case below could never run after the
// unconfigured one. Tearing the app down is what makes these independent.
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe('the app with no Firebase config', () => {
  test('imports without throwing', async () => {
    withoutConfig();

    // The bug, in one line: this used to reject with auth/invalid-api-key, and
    // every module importing it went down with it.
    await expect(import('../../config/firebase')).resolves.toBeDefined();
  });

  test('reports the cloud as unconfigured and hands back no handles', async () => {
    withoutConfig();

    const mod = await import('../../config/firebase');

    expect(mod.isCloudConfigured).toBe(false);
    // Null rather than a half-built handle: the type is what forces every call
    // site to say what it does without a cloud.
    expect(mod.auth).toBeNull();
    expect(mod.db).toBeNull();
  });

  test('observing auth state does nothing rather than throwing', async () => {
    withoutConfig();
    const mod = await import('../../config/firebase');
    const dispatch = vi.fn();

    expect(() => mod.observeAuthState(dispatch as never)).not.toThrow();
    // Silence, not a false "unauthed" claim -- there is no auth to be un of.
    expect(dispatch).not.toHaveBeenCalled();
  });

  test('a cloud read fails with a named error instead of a crash', async () => {
    withoutConfig();
    const mod = await import('../../config/firebase');

    await expect(mod.fetchDataFromFirestore('anyone')).rejects.toThrow(
      /not configured/i
    );
  });
});

// THE CONTROL. Every assertion above would pass against a module that had
// simply been broken into inertness, so the configured path has to be shown
// working in the same file.
describe('CONTROL: the app with a Firebase config', () => {
  test('reports the cloud as configured and builds real handles', async () => {
    withConfig();

    const mod = await import('../../config/firebase');

    expect(mod.isCloudConfigured).toBe(true);
    expect(mod.auth).not.toBeNull();
    expect(mod.db).not.toBeNull();
  });
});
