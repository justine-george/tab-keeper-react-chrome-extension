import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { saveToFirestore } from '../../utils/functions/external';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-600. The cloud copy never receives the run's example, or its grave.
describe('a cloud write leaves the example out (KAN-600)', () => {
  beforeEach(() => firestore.setDoc.mockReset().mockResolvedValue(undefined));

  it('writes no sample session and no sample grave; the rest as given', async () => {
    const container = buildContainer([
      buildSession({ tabGroupId: 'kept' }),
      buildSession({ tabGroupId: 'sample:1' }),
    ]);
    container.deletedTabGroups = [
      { tabGroupId: 'gone', deletedAt: 900 },
      { tabGroupId: 'sample:0', deletedAt: 901 },
    ];
    await saveToFirestore('u1', container);
    const written = firestore.setDoc.mock.calls[0][1] as {
      tabGroups: { tabGroupId: string }[];
      deletedTabGroups: { tabGroupId: string }[];
    };
    expect(written.tabGroups.map((g) => g.tabGroupId)).toEqual(['kept']);
    expect(written.deletedTabGroups.map((g) => g.tabGroupId)).toEqual(['gone']);
    // The caller's container is not changed.
    expect(container.tabGroups).toHaveLength(2);
  });

  // Firestore rejects an explicit undefined (KAN-48); a backup from before graves has none.
  it('a container with no graves is written with no graves key', async () => {
    const container = buildContainer([buildSession({ tabGroupId: 'kept' })]);
    delete container.deletedTabGroups;
    await saveToFirestore('u1', container);
    const written = firestore.setDoc.mock.calls[0][1] as object;
    expect(Object.keys(written)).not.toContain('deletedTabGroups');
  });
});
