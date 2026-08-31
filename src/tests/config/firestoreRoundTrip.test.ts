import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
}));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInAnonymously: vi.fn(),
}));
vi.mock('firebase/firestore/lite', () => ({
  doc: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({})),
  setDoc: vi.fn(),
  getDoc: firestore.getDoc,
}));

import { fetchDataFromFirestore } from '../../config/firebase';

// fetchDataFromFirestore rebuilds the container field by field, which makes it
// a whitelist: a field added to the persisted shape but not listed there is
// written to Firestore and then silently dropped on the way back in.
//
// deletedTabGroups was exactly that, and the consequences were severe. The
// merge kept producing a tombstone, every read produced a cloud with no record
// of the delete, so changedFromCloud recomputed as true forever - an unbounded
// Firestore write loop - and the deletion never propagated to another device.
// Confirmed against the real extension before this test was written: a single
// delete produced 60+ commits of the same document.
describe('the Firestore read preserves the whole container', () => {
  const stored = {
    lastModified: 1000,
    selectedTabGroupId: 'a',
    tabGroups: [{ tabGroupId: 'a', lastModified: 1000 }],
    deletedTabGroups: [{ tabGroupId: 'gone', deletedAt: 900 }],
  };

  beforeEach(() => {
    firestore.getDoc.mockReset().mockResolvedValue({
      exists: () => true,
      data: () => stored,
    });
  });

  it('returns tombstones, not just sessions', async () => {
    const read = await fetchDataFromFirestore('u1');
    expect(read.deletedTabGroups).toEqual([
      { tabGroupId: 'gone', deletedAt: 900 },
    ]);
  });

  it('round-trips every field the persisted container declares', async () => {
    const read = await fetchDataFromFirestore('u1');
    // Compared as whole objects so a future field added to the shape but
    // omitted from the read fails here rather than in production.
    expect(read).toEqual(stored);
  });

  it('leaves a pre-tombstone document valid, with the field simply absent', async () => {
    const legacy = {
      lastModified: 1000,
      selectedTabGroupId: null,
      tabGroups: [],
    };
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => legacy,
    });
    const read = await fetchDataFromFirestore('u1');
    expect(read.deletedTabGroups).toBeUndefined();
    expect(read.tabGroups).toEqual([]);
  });
});
