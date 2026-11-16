import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
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
import {
  COMPRESS_FROM_BYTES,
  encodeCloudDocument,
} from '../../utils/functions/cloudDocument';
import { readImportedContainer } from '../../utils/functions/local';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import {
  mergeSessionsFromBackupInternal,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-862 (11-16 13:05). An imported session's mark is part of the session: every path a session
// travels keeps it. Each of these passes through wholesale today; they fail the day one rebuilds
// sessions field by field and leaves it out.

const imported = (overrides: Partial<tabContainerData> = {}) =>
  buildSession({
    tabGroupId: 'imp',
    importedFrom: 'bookmarks',
    lastModified: 2000,
    ...overrides,
  });

const markOf = (c: { tabGroups: unknown }, id = 'imp') =>
  (c.tabGroups as tabContainerData[]).find((g) => g.tabGroupId === id)
    ?.importedFrom;

// A Firestore Bytes value, as the lite SDK hands one back.
const asBytesValue = (bytes: Uint8Array) => ({ toUint8Array: () => bytes });

// What fetchDataFromFirestore reads back from what encodeCloudDocument wrote.
async function throughTheCloud(c: TabMasterContainer) {
  const encoded = await encodeCloudDocument(c);
  const stored = encoded.compressed
    ? {
        ...encoded.fields,
        tabGroupsZ: asBytesValue(encoded.fields.tabGroupsZ),
      }
    : encoded.fields;
  firestore.getDoc.mockResolvedValue({
    exists: () => true,
    data: () => stored,
  });
  return {
    compressed: encoded.compressed,
    read: await fetchDataFromFirestore('u1'),
  };
}

beforeEach(() => {
  firestore.getDoc.mockReset();
  localStorage.clear();
});

describe('the imported mark travels with its session', () => {
  it('through the sync merge, whichever side wins', () => {
    const here = buildContainer([imported()]);
    const older = buildContainer([imported({ lastModified: 1000 })]);
    const newer = buildContainer([
      imported({ lastModified: 3000, title: 'Renamed' }),
    ]);
    expect(markOf(mergeTabContainers(here, older, 5000).merged)).toBe(
      'bookmarks'
    );
    const merged = mergeTabContainers(here, newer, 5000).merged;
    expect(merged.tabGroups[0].title).toBe('Renamed');
    expect(markOf(merged)).toBe('bookmarks');
  });

  it('through a plain cloud write and read', async () => {
    const { compressed, read } = await throughTheCloud(
      buildContainer([imported()])
    );
    expect(compressed).toBe(false);
    expect(markOf(read)).toBe('bookmarks');
  });

  it('through a compressed cloud write and read (KAN-6)', async () => {
    const big = buildSession({
      tabGroupId: 'big',
      title: 'x'.repeat(COMPRESS_FROM_BYTES),
    });
    const { compressed, read } = await throughTheCloud(
      buildContainer([imported(), big])
    );
    expect(compressed).toBe(true);
    expect(markOf(read)).toBe('bookmarks');
    expect(markOf(read, 'big')).toBeUndefined();
  });

  it('through a backup file saved and loaded with Merge (KAN-962)', () => {
    // saveBackupFile writes the container as JSON; loadBackupFile reads it with readImportedContainer.
    const file = JSON.stringify(buildContainer([imported()]));
    const container = readImportedContainer(file);
    expect(markOf(container)).toBe('bookmarks');

    const { store } = makeTestStore();
    store.dispatch(mergeSessionsFromBackupInternal(container));
    expect(markOf(store.getState().tabContainerDataState)).toBe('bookmarks');
  });
});
