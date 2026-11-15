import type {
  deletedTabGroup,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { compressToBytes } from './compression';
import {
  bytesToMB,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  IMPORT_SIZE_REFUSAL,
  stripEmbeddedFavicons,
  syncLimitInMB,
  TranslatableError,
} from './local';
import { withoutSamples } from './sampleSession';

// KAN-6 phase 2. The fields sync writes, decided per write from its size alone.
// No Firebase import: the slice uses this directly, and its tests mock only external.ts.

// From here sessions are written gzipped; below it the document is the one every version reads.
export const COMPRESS_FROM_BYTES = Math.ceil(
  FIRESTORE_MAX_DOCUMENT_BYTES * 0.8
);

export type CompressedFields = {
  lastModified: number;
  selectedTabGroupId: string | null;
  deletedTabGroups?: deletedTabGroup[];
  tabGroupsZ: Uint8Array;
};

export type EncodedCloudDocument =
  | { compressed: false; fields: TabMasterContainer; bytes: number }
  | { compressed: true; fields: CompressedFields; bytes: number };

const utf8Bytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

// What every write sends: the run's example and embedded favicons stay on this device (KAN-600, KAN-594).
const prepare = (container: TabMasterContainer): TabMasterContainer =>
  stripEmbeddedFavicons(withoutSamples(container));

async function compress(
  prepared: TabMasterContainer
): Promise<{ fields: CompressedFields; bytes: number }> {
  const { tabGroups, lastModified, selectedTabGroupId, deletedTabGroups } =
    prepared;
  // Absent stays absent: Firestore refuses a field set to undefined.
  const plain = {
    lastModified,
    selectedTabGroupId,
    ...(deletedTabGroups === undefined ? {} : { deletedTabGroups }),
  };
  const tabGroupsZ = await compressToBytes(JSON.stringify(tabGroups));
  return {
    fields: { ...plain, tabGroupsZ },
    bytes: tabGroupsZ.byteLength + utf8Bytes(plain),
  };
}

export async function encodeCloudDocument(
  container: TabMasterContainer
): Promise<EncodedCloudDocument> {
  const prepared = prepare(container);
  const plainBytes = utf8Bytes(prepared);
  if (plainBytes < COMPRESS_FROM_BYTES) {
    return { compressed: false, fields: prepared, bytes: plainBytes };
  }
  return { compressed: true, ...(await compress(prepared)) };
}

// The compressed document's size at any account size: what the bar and the import measure.
export async function syncBytes(
  container: TabMasterContainer
): Promise<number> {
  return (await compress(prepare(container))).bytes;
}

// KAN-27. Refused, not imported with a warning: restoreContainer persists it and isDirty would
// stay set against a document Firestore never accepts, wedging every later sync. KAN-6: compressed size.
export async function refuseOversizeImport(
  container: TabMasterContainer,
  locale: string
): Promise<void> {
  const bytes = await syncBytes(container);
  if (bytes > FIRESTORE_MAX_DOCUMENT_BYTES) {
    throw new TranslatableError(IMPORT_SIZE_REFUSAL, {
      used: bytesToMB(bytes, locale),
      limit: syncLimitInMB(locale),
    });
  }
}
