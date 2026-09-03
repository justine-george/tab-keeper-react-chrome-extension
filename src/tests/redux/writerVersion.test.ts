import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const firestore = vi.hoisted(() => ({ setDoc: vi.fn() }));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInAnonymously: vi.fn(),
}));
vi.mock('firebase/firestore/lite', () => ({
  doc: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({})),
  getDoc: vi.fn(),
  setDoc: firestore.setDoc,
}));

import {
  saveToFirestore,
  CURRENT_WRITER_VERSION,
} from '../../utils/functions/external';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

describe('every save records which client wrote it', () => {
  beforeEach(() => firestore.setDoc.mockReset().mockResolvedValue(undefined));

  // The constant is pinned to a literal, not just compared against itself.
  // `expect(written.writerVersion).toBe(CURRENT_WRITER_VERSION)` alone is a
  // tautology: before the constant existed the import resolved to undefined and
  // the assertion reduced to expect(undefined).toBe(undefined), which passes
  // against a save that stamps nothing at all.
  it('exports a concrete writer version', () => {
    expect(CURRENT_WRITER_VERSION).toBe(2);
  });

  it('stamps writerVersion', async () => {
    await saveToFirestore('u1', buildContainer([buildSession()]));
    const written = firestore.setDoc.mock.calls[0][1] as {
      writerVersion?: number;
    };
    expect(written.writerVersion).toBe(2);
    expect(written.writerVersion).toBe(CURRENT_WRITER_VERSION);
  });

  // Phase 1 must not move session data. If this ever fails, a write-side
  // format change has crept in and old clients will crash on it.
  it('still writes sessions as a plain tabGroups array', async () => {
    await saveToFirestore('u1', buildContainer([buildSession()]));
    const written = firestore.setDoc.mock.calls[0][1] as {
      tabGroups?: unknown;
      tabGroupsZ?: unknown;
    };
    expect(Array.isArray(written.tabGroups)).toBe(true);
    expect(written.tabGroupsZ).toBeUndefined();
  });

  it('leaves tombstones untouched alongside the stamp', async () => {
    const container = buildContainer([buildSession()]);
    container.deletedTabGroups = [{ tabGroupId: 'gone', deletedAt: 900 }];
    await saveToFirestore('u1', container);
    const written = firestore.setDoc.mock.calls[0][1] as {
      deletedTabGroups?: unknown;
    };
    expect(written.deletedTabGroups).toEqual([
      { tabGroupId: 'gone', deletedAt: 900 },
    ]);
  });
});
