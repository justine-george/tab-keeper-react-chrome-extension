import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const firestore = vi.hoisted(() => ({ getDoc: vi.fn() }));

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
import { compressToBytes } from '../../utils/functions/compression';

const sessions = [
  { tabGroupId: 'a', title: 'Alpha', lastModified: 1000, createdAt: 1000 },
];

// A Firestore Bytes value is an object exposing toUint8Array(); the reader must
// accept that as well as a bare Uint8Array, because the lite SDK hands back the
// former and tests construct the latter.
const asBytesValue = (bytes: Uint8Array) => ({ toUint8Array: () => bytes });

describe('the reader understands both document shapes', () => {
  beforeEach(() => firestore.getDoc.mockReset());

  it('reads a legacy uncompressed document unchanged', async () => {
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        lastModified: 1000,
        selectedTabGroupId: 'a',
        tabGroups: sessions,
        deletedTabGroups: [{ tabGroupId: 'gone', deletedAt: 900 }],
      }),
    });
    const read = await fetchDataFromFirestore('u1');
    expect(read.tabGroups).toEqual(sessions);
    expect(read.deletedTabGroups).toEqual([
      { tabGroupId: 'gone', deletedAt: 900 },
    ]);
  });

  it('reads a compressed document to the identical container', async () => {
    const packed = await compressToBytes(JSON.stringify(sessions));
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        lastModified: 1000,
        selectedTabGroupId: 'a',
        tabGroupsZ: asBytesValue(packed),
        deletedTabGroups: [{ tabGroupId: 'gone', deletedAt: 900 }],
      }),
    });
    const read = await fetchDataFromFirestore('u1');
    expect(read.tabGroups).toEqual(sessions);
    // Tombstones stay plain fields and must survive untouched.
    expect(read.deletedTabGroups).toEqual([
      { tabGroupId: 'gone', deletedAt: 900 },
    ]);
  });

  it('accepts a bare Uint8Array as well as a Bytes value', async () => {
    const packed = await compressToBytes(JSON.stringify(sessions));
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        lastModified: 1000,
        selectedTabGroupId: 'a',
        tabGroupsZ: packed,
      }),
    });
    const read = await fetchDataFromFirestore('u1');
    expect(read.tabGroups).toEqual(sessions);
  });

  // "Could not decode" and "no sessions" must never be conflated: an empty
  // array reads as a valid, empty account and would be written straight over
  // the document. undefined fails isValidTabMasterContainer, which stops the
  // sync without writing (Task 1).
  it('yields undefined tabGroups when tabGroupsZ will not decode', async () => {
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        lastModified: 1000,
        selectedTabGroupId: null,
        tabGroupsZ: asBytesValue(new Uint8Array([9, 9, 9, 9])),
      }),
    });
    const read = await fetchDataFromFirestore('u1');
    expect(read.tabGroups).toBeUndefined();
  });

  it('yields undefined tabGroups when tabGroupsZ decodes to a non-array', async () => {
    const packed = await compressToBytes('{"not":"an array"}');
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        lastModified: 1000,
        selectedTabGroupId: null,
        tabGroupsZ: asBytesValue(packed),
      }),
    });
    const read = await fetchDataFromFirestore('u1');
    expect(read.tabGroups).toBeUndefined();
  });

  it('prefers tabGroupsZ when a document somehow carries both', async () => {
    const packed = await compressToBytes(JSON.stringify(sessions));
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        lastModified: 1000,
        selectedTabGroupId: 'a',
        tabGroups: [{ tabGroupId: 'stale', title: 'Stale' }],
        tabGroupsZ: asBytesValue(packed),
      }),
    });
    const read = await fetchDataFromFirestore('u1');
    expect(read.tabGroups).toEqual(sessions);
  });
});
