import type { IconName } from '../../../common/iconNames';

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
 *  2. Auto sync off: nothing IS sent, whatever the cloud is doing. Manual.
 *     Before the cloud check on purpose -- PR CI builds without a cloud
 *     (KAN-147), and this order is what lets the e2e see the toggle work there.
 *  3. No cloud in this build: unavailable. Never shown to a user; every
 *     release carries one. Without it the CI popup would claim "on".
 *  4. The last sync failed: say so, and where the retry is.
 *  5. On. `loading` and `idle` land here too: the half-second before auth
 *     resolves at cold start would otherwise flash "unavailable" on every open.
 *
 * `title` and `line` are i18n keys; the card passes them through t().
 */
export type SyncKind = 'unavailable' | 'manual' | 'failed' | 'on';

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
  syncStatus,
}: {
  isSignedIn: boolean;
  isAutoSync: boolean;
  isCloudConfigured: boolean;
  syncStatus: 'idle' | 'loading' | 'success' | 'error';
}): SyncPresentation {
  if (!isSignedIn) {
    return {
      kind: 'unavailable',
      icon: 'cloud_off',
      title: 'Sync unavailable',
      line: 'Enable Chrome sync for seamless data syncing.',
    };
  }
  if (!isAutoSync) {
    return {
      kind: 'manual',
      icon: 'cloud',
      title: 'Manual sync',
      line: 'Changes stay on this device until you press the cloud button.',
    };
  }
  if (!isCloudConfigured) {
    return {
      kind: 'unavailable',
      icon: 'cloud_off',
      title: 'Sync unavailable',
      line: 'Enable Chrome sync for seamless data syncing.',
    };
  }
  if (syncStatus === 'error') {
    return {
      kind: 'failed',
      icon: 'sync_problem',
      title: 'Last sync failed',
      line: 'Sessions on this device are safe. Press the cloud button to try again.',
    };
  }
  return {
    kind: 'on',
    icon: 'cloud_done',
    title: 'Cloud sync on',
    line: 'Synced with an anonymous token in your Chrome profile. No account, no email.',
  };
}
