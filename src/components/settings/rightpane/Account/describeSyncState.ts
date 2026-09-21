import type { IconName } from '../../../common/iconNames';
import type { CloudConsent } from '../../../../redux/slices/settingsDataStateSlice';

/**
 * What the sync status card says, from the same facts the header's cloud
 * icon reads (KAN-248).
 *
 * It used to render LoggedIn or NotLoggedIn on `isSignedIn` alone, so it said
 * "Cloud Sync Active" under an Auto Sync button reading Off, and after a
 * failed sync while the header showed sync_problem. One derivation, in an
 * order that makes each line true:
 *
 *  1. No token: nothing can be sent. Unavailable.
 *  2. The cloud question declined, or not yet answered (KAN-259): off. Not
 *     "manual" -- the cloud button asks that user first rather than syncing,
 *     so "until you press the cloud button" would be a half-truth for them.
 *  3. Auto sync off with consent given: nothing IS sent, whatever the cloud
 *     is doing. Manual. Before the cloud check on purpose -- PR CI builds
 *     without a cloud (KAN-147), and this order is what lets the e2e see the
 *     toggle work there.
 *  4. No cloud in this build: unavailable. Never shown to a user; every
 *     release carries one. Without it the CI popup would claim "on".
 *  5. The last sync failed: say so, and where the retry is.
 *  6. On. `loading` and `idle` land here too: the half-second before auth
 *     resolves at cold start would otherwise flash "unavailable" on every open.
 *
 * `title` and `line` are i18n keys; the card passes them through t().
 */
export type SyncKind = 'unavailable' | 'off' | 'manual' | 'failed' | 'on';

export interface SyncPresentation {
  kind: SyncKind;
  icon: IconName;
  title: string;
  line: string;
}

export function describeSyncState({
  isSignedIn,
  isAutoSync,
  isCloudConfigured,
  cloudConsent,
  syncStatus,
}: {
  isSignedIn: boolean;
  isAutoSync: boolean;
  isCloudConfigured: boolean;
  cloudConsent: CloudConsent;
  syncStatus: 'idle' | 'loading' | 'success' | 'error';
}): SyncPresentation {
  if (!isSignedIn) {
    return {
      kind: 'unavailable',
      icon: 'cloud_off',
      title: 'Sync unavailable',
      line: 'Chrome’s sync storage isn’t available in this profile, so your sessions stay on this device.',
    };
  }
  if (cloudConsent !== 'granted') {
    return {
      kind: 'off',
      icon: 'cloud',
      title: 'Sync is off',
      line: 'Your sessions stay on this device. Turn on Auto Sync, or press the cloud button on the home screen, to start syncing.',
    };
  }
  if (!isAutoSync) {
    return {
      kind: 'manual',
      icon: 'cloud',
      title: 'Manual sync',
      line: 'Your sessions stay on this device until you press the cloud button on the home screen.',
    };
  }
  if (!isCloudConfigured) {
    return {
      kind: 'unavailable',
      icon: 'cloud_off',
      title: 'Sync unavailable',
      line: 'Chrome’s sync storage isn’t available in this profile, so your sessions stay on this device.',
    };
  }
  if (syncStatus === 'error') {
    return {
      kind: 'failed',
      icon: 'sync_problem',
      title: 'Last sync failed',
      line: 'Your sessions are safe on this device. Press the cloud button on the home screen to try again.',
    };
  }
  return {
    kind: 'on',
    icon: 'cloud_done',
    title: 'Cloud sync on',
    line: 'Your sessions sync automatically across your Chrome devices. No separate sign-in is needed.',
  };
}
