import { describe, expect, test } from 'vitest';

import {
  formatSyncLimit,
  formatSyncUsed,
  syncSpaceLevel,
} from '../../../utils/functions/syncSpace';
import { FIRESTORE_MAX_DOCUMENT_BYTES } from '../../../utils/functions/local';

// KAN-596. The bar under Sync Status reads the number the sync checks before it writes.

const LIMIT = FIRESTORE_MAX_DOCUMENT_BYTES;

describe('syncSpaceLevel', () => {
  test('ok below 80%, near from 80%, full only past the limit the sync refuses', () => {
    expect(syncSpaceLevel(0)).toBe('ok');
    expect(syncSpaceLevel(Math.ceil(LIMIT * 0.8) - 1)).toBe('ok');
    expect(syncSpaceLevel(Math.ceil(LIMIT * 0.8))).toBe('near');
    // saveToFirestoreIfDirty refuses only bytes > limit, so the limit itself still syncs.
    expect(syncSpaceLevel(LIMIT)).toBe('near');
    expect(syncSpaceLevel(LIMIT + 1)).toBe('full');
  });
});

describe('formatSyncUsed and formatSyncLimit', () => {
  test('kilobytes below the limit, whole numbers', () => {
    expect(formatSyncUsed(186_070, 'en')).toBe('182 kB');
    expect(formatSyncUsed(0, 'en')).toBe('0 kB');
  });

  test('megabytes from 1 MiB, one decimal, as the refusal toast says it', () => {
    expect(formatSyncUsed(LIMIT, 'en')).toBe('1.0 MB');
    expect(formatSyncUsed(1_153_434, 'en')).toBe('1.1 MB');
  });

  test('the limit reads 1 MB', () => {
    expect(formatSyncLimit('en')).toBe('1 MB');
  });

  test('units follow the language', () => {
    expect(formatSyncUsed(186_070, 'fr')).toBe('182\u202fko');
    expect(formatSyncUsed(1_153_434, 'de')).toBe('1,1 MB');
    expect(formatSyncLimit('fr')).toBe('1\u202fMo');
  });
});
