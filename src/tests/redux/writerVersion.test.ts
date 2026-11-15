import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const firestore = vi.hoisted(() => ({ setDoc: vi.fn(), getDoc: vi.fn() }));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInAnonymously: vi.fn(),
}));
vi.mock('firebase/firestore/lite', () => ({
  doc: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({})),
  getDoc: firestore.getDoc,
  setDoc: firestore.setDoc,
  // A Bytes value as a read yields it: toUint8Array() gives the bytes back.
  Bytes: {
    fromUint8Array: (u: Uint8Array) => ({ toUint8Array: () => u }),
  },
}));

import {
  saveToFirestore,
  CURRENT_WRITER_VERSION,
} from '../../utils/functions/external';
import { fetchDataFromFirestore } from '../../config/firebase';
import { COMPRESS_FROM_BYTES } from '../../utils/functions/cloudDocument';
import { decompressFromBytes } from '../../utils/functions/compression';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-6. One session whose tab url pads the plain document past the compress line.
function bigContainer() {
  const base = buildSession({ tabGroupId: 'big' });
  const tab = base.windows[0].tabs[0];
  return buildContainer([
    {
      ...base,
      windows: [
        {
          ...base.windows[0],
          tabs: [
            { ...tab, url: `${tab.url}${'a'.repeat(COMPRESS_FROM_BYTES)}` },
          ],
        },
      ],
    },
  ]);
}

describe('every save records which client wrote it', () => {
  beforeEach(() => firestore.setDoc.mockReset().mockResolvedValue(undefined));

  it('stamps writerVersion', async () => {
    await saveToFirestore('u1', buildContainer([buildSession()]));
    const written = firestore.setDoc.mock.calls[0][1] as {
      writerVersion?: number;
    };
    expect(written.writerVersion).toBe(2);
    expect(written.writerVersion).toBe(CURRENT_WRITER_VERSION);
  });

  // KAN-6. Below the compress line the document is the one every version reads.
  it('a small account still writes a plain tabGroups array', async () => {
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

  it('a big account writes tabGroupsZ and no tabGroups', async () => {
    await saveToFirestore('u1', bigContainer());
    const written = firestore.setDoc.mock.calls[0][1] as {
      tabGroups?: unknown;
      tabGroupsZ?: { toUint8Array: () => Uint8Array };
      writerVersion?: number;
    };
    expect('tabGroups' in written).toBe(false);
    expect(written.writerVersion).toBe(2);
    const sessions = JSON.parse(
      await decompressFromBytes(written.tabGroupsZ!.toUint8Array())
    ) as { tabGroupId: string }[];
    expect(sessions.map((g) => g.tabGroupId)).toEqual(['big']);
  });

  it('what a big account writes reads back as its sessions', async () => {
    const container = bigContainer();
    await saveToFirestore('u1', container);
    const written: unknown = firestore.setDoc.mock.calls[0][1];
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => written,
    });
    const read = await fetchDataFromFirestore('u1');
    expect(read.tabGroups).toEqual(container.tabGroups);
    expect(read.lastModified).toBe(container.lastModified);
  });
});
