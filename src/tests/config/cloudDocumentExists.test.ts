import { describe, it, expect, vi, beforeEach } from 'vitest';

const firestore = vi.hoisted(() => ({ getDoc: vi.fn(), doc: vi.fn() }));
const fakeDb = vi.hoisted(() => ({ name: 'fake-db' }));

vi.mock('firebase/firestore/lite', () => ({
  deleteDoc: vi.fn(),
  doc: firestore.doc,
  getDoc: firestore.getDoc,
  setDoc: vi.fn(),
}));
vi.mock('../../config/firebase', () => ({
  db: fakeDb,
  cloudUnavailable: () => new Error('Firebase is not configured in this build'),
  fetchDataFromFirestore: vi.fn(),
  ensureCloudSessionReady: vi.fn(),
}));

import { cloudDocumentExists } from '../../utils/functions/external';

// KAN-719. Delete cloud data asks whether the document exists before it asks to delete it.
describe('cloudDocumentExists', () => {
  beforeEach(() => {
    firestore.getDoc.mockReset();
    firestore.doc.mockReset().mockReturnValue({ ref: 'doc-ref' });
  });

  it('answers true for a document that exists', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => true });
    expect(await cloudDocumentExists('uuid-1')).toBe(true);
    expect(firestore.doc).toHaveBeenCalledWith(
      fakeDb,
      'tabGroupData',
      'uuid-1'
    );
    expect(firestore.getDoc).toHaveBeenCalledWith({ ref: 'doc-ref' });
  });

  it('answers false for a missing document', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    expect(await cloudDocumentExists('uuid-1')).toBe(false);
  });

  it('rejects when this build has no cloud, without reading', async () => {
    vi.resetModules();
    vi.doMock('../../config/firebase', () => ({
      db: null,
      cloudUnavailable: () => new Error('Firebase is not configured'),
      fetchDataFromFirestore: vi.fn(),
      ensureCloudSessionReady: vi.fn(),
    }));
    const { cloudDocumentExists: noCloud } =
      await import('../../utils/functions/external');
    await expect(noCloud('uuid-1')).rejects.toThrow('not configured');
    expect(firestore.getDoc).not.toHaveBeenCalled();
    vi.doUnmock('../../config/firebase');
  });

  it('a failed read rejects; it is never "missing"', async () => {
    firestore.getDoc.mockRejectedValue(new Error('permission-denied'));
    await expect(cloudDocumentExists('uuid-1')).rejects.toThrow(
      'permission-denied'
    );
  });
});
