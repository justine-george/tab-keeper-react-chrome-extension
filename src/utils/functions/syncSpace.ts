import { FIRESTORE_MAX_DOCUMENT_BYTES } from './local';

// KAN-596. How full the one Firestore document the sync writes is.

export type SyncSpaceLevel = 'ok' | 'near' | 'full';

// From here the bar turns red and says what to do.
const NEAR_SHARE = 0.8;

// 'full' is what saveToFirestoreIfDirty refuses: strictly over the limit.
export function syncSpaceLevel(bytes: number): SyncSpaceLevel {
  if (bytes > FIRESTORE_MAX_DOCUMENT_BYTES) return 'full';
  if (bytes >= FIRESTORE_MAX_DOCUMENT_BYTES * NEAR_SHARE) return 'near';
  return 'ok';
}

const unit = (
  locale: string,
  name: 'kilobyte' | 'megabyte',
  fractionDigits: number
) =>
  new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: name,
    unitDisplay: 'short',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

const wholeKilobytes = (bytes: number): number => Math.round(bytes / 1024);

// Whole kilobytes under 1 MiB; past it, megabytes to one decimal, as the refusal toast writes them.
export function formatSyncUsed(bytes: number, locale: string): string {
  return bytes < FIRESTORE_MAX_DOCUMENT_BYTES
    ? unit(locale, 'kilobyte', 0).format(wholeKilobytes(bytes))
    : unit(locale, 'megabyte', 1).format(bytes / FIRESTORE_MAX_DOCUMENT_BYTES);
}

// KAN-625. The line reads more than 0 kB, so the bar shows at least a sliver; rounded the same way.
export function isSyncUseShown(bytes: number): boolean {
  return wholeKilobytes(bytes) > 0;
}

// Whole megabytes; the refusal toasts write the same number with syncLimitInMB (KAN-634).
export const formatSyncLimit = (locale: string): string =>
  unit(locale, 'megabyte', 0).format(1);
