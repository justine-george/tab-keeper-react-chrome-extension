import { beforeEach, describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const fake = vi.hoisted(() => ({
  getAuth: vi.fn(() => ({ currentUser: null })),
}));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: fake.getAuth,
  onAuthStateChanged: vi.fn(() => () => {}),
  signInAnonymously: vi.fn(),
}));
vi.mock('firebase/firestore/lite', () => ({
  doc: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({})),
  getDoc: vi.fn(),
}));

// KAN-419. getAuth restores a stored user with a network call, so only a sync may build it.
describe('Firebase Auth is built on first use (KAN-419)', () => {
  beforeEach(() => {
    vi.resetModules();
    fake.getAuth.mockClear();
  });

  test('importing the module builds no Auth', async () => {
    await import('../../config/firebase');

    expect(fake.getAuth).not.toHaveBeenCalled();
  });

  test('CONTROL: a sync starting builds it', async () => {
    const firebase = await import('../../config/firebase');

    firebase.ensureCloudSession(vi.fn());

    expect(fake.getAuth).toHaveBeenCalled();
  });
});
