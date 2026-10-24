import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';

import Icon from '../../components/common/Icon';
import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { describeSyncState } from '../../components/settings/rightpane/Account/describeSyncState';
import {
  deviceIdReadFinished,
  setAwaitsDeviceId,
  setCloudConfigured,
  setSignedIn,
  setSyncStatus,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import {
  declineCloudConsent,
  grantCloudConsent,
  markCloudDeletedElsewhere,
  setLastSyncedTime,
  toggleAutoSync,
} from '../../redux/slices/settingsDataStateSlice';
import { sessionWhen } from '../../utils/functions/sessionDate';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import type { makeTestStore } from '../setup/makeStore';

// KAN-342, settled as S2. The header's sync button used to be named "Sync now"
// in every state, dimmed or not, so a screen reader heard "Sync now, dimmed"
// with nothing saying why. Now:
//
// - Clickable: the name stays the action, "Sync now". The state is the
//   button's description and the first line of a two-line tooltip.
// - Dimmed: there is nothing to press, so the state IS the name and tooltip.
//
// The state words are the Sync & Backup card's (describeSyncState), with one
// deliberate exception pinned below: a running sync dims the button in every
// mode, and the dimmed name says why ("Syncing…"), even under Manual sync,
// where the card keeps describing the setting.

type Store = ReturnType<typeof makeTestStore>['store'];

/**
 * When the last sync finished, dated like a session (KAN-584): earlier today
 * on a pinned clock, so the words don't drift as real time passes.
 * lastSyncedDate.test.tsx pins the format itself.
 */
const SYNCED_AT = new Date(2026, 8, 29, 16, 28, 40).getTime();
const NOW = new Date(2026, 8, 29, 18, 0);
const WHEN = `Last synced ${sessionWhen(SYNCED_AT, 'en', 'h12', new Date(2026, 8, 29))}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Signed in, a cloud configured, and the sync question answered yes. */
function ready(store: Store): void {
  store.dispatch(setSignedIn());
  store.dispatch(setCloudConfigured(true));
  store.dispatch(grantCloudConsent());
  // A sync has started this page load; before one, the boot wait is its own case.
  store.dispatch(syncStateWithFirestore.pending('boot', undefined));
  store.dispatch(setSyncStatus('idle'));
}

interface Case {
  state: string;
  seed: (store: Store) => void;
  name: string;
  description: string | null;
  tooltip: string;
  dimmed: boolean;
}

const CASES: Case[] = [
  {
    state: 'unavailable',
    // The default store once the read finds no id: signed out, no cloud, Auto Sync on, no answer yet.
    seed: (s) => {
      s.dispatch(deviceIdReadFinished());
    },
    name: 'Sync unavailable',
    description: null,
    tooltip: 'Sync unavailable',
    dimmed: true,
  },
  {
    // KAN-750 R19. Before the stored id is read, named as signed in: nothing is known to be unavailable.
    state: 'id not read yet',
    seed: () => {},
    name: 'Sync now',
    description: 'Sync is off',
    tooltip: 'Sync is off · Sync now',
    dimmed: false,
  },
  {
    state: 'off',
    seed: (s) => {
      s.dispatch(setSignedIn());
      s.dispatch(setCloudConfigured(true));
      s.dispatch(declineCloudConsent());
    },
    name: 'Sync now',
    description: 'Sync is off',
    tooltip: 'Sync is off · Sync now',
    dimmed: false,
  },
  {
    // KAN-759. Off because another device deleted the cloud copy.
    state: 'deleted elsewhere',
    seed: (s) => {
      s.dispatch(setSignedIn());
      s.dispatch(setCloudConfigured(true));
      s.dispatch(markCloudDeletedElsewhere({ wasAutoSync: true }));
      s.dispatch(declineCloudConsent());
    },
    name: 'Sync now',
    description: 'Cloud copy deleted',
    tooltip: 'Cloud copy deleted · Sync now',
    dimmed: false,
  },
  {
    // KAN-599. A fresh install with no id yet: the press asks, and the yes mints one.
    state: 'off, no id yet',
    seed: (s) => {
      s.dispatch(setAwaitsDeviceId(true));
      s.dispatch(setCloudConfigured(true));
      s.dispatch(declineCloudConsent());
    },
    name: 'Sync now',
    description: 'Sync is off',
    tooltip: 'Sync is off · Sync now',
    dimmed: false,
  },
  {
    state: 'manual',
    seed: (s) => {
      ready(s);
      s.dispatch(toggleAutoSync());
    },
    name: 'Sync now',
    description: 'Manual sync',
    tooltip: 'Manual sync · Sync now',
    dimmed: false,
  },
  {
    // KAN-346: a Sync now press with Auto Sync off can fail too.
    state: 'manual, failed',
    seed: (s) => {
      ready(s);
      s.dispatch(toggleAutoSync());
      s.dispatch(setSyncStatus('error'));
    },
    name: 'Sync now',
    description: 'Last sync failed',
    tooltip: 'Last sync failed · Sync now',
    dimmed: false,
  },
  {
    state: 'failed',
    seed: (s) => {
      ready(s);
      // A time on record must not read as reassurance over a failure.
      s.dispatch(setLastSyncedTime(SYNCED_AT));
      s.dispatch(setSyncStatus('error'));
    },
    name: 'Sync now',
    description: 'Last sync failed',
    tooltip: 'Last sync failed · Sync now',
    dimmed: false,
  },
  {
    state: 'syncing',
    seed: (s) => {
      ready(s);
      s.dispatch(setSyncStatus('loading'));
    },
    name: 'Syncing…',
    description: null,
    tooltip: 'Syncing…',
    dimmed: true,
  },
  {
    // Once synced there is nothing known to send, so the second line says
    // when, as the card does (Justine's pick A, 2026-09-29). A click still
    // reads the cloud for other devices' changes, so the name stays.
    state: 'synced',
    seed: (s) => {
      ready(s);
      s.dispatch(setLastSyncedTime(SYNCED_AT));
      s.dispatch(setSyncStatus('success'));
    },
    name: 'Sync now',
    description: `Cloud sync on\n${WHEN}`,
    tooltip: `Cloud sync on · ${WHEN}`,
    dimmed: false,
  },
  {
    state: 'manual, synced',
    seed: (s) => {
      ready(s);
      s.dispatch(toggleAutoSync());
      s.dispatch(setLastSyncedTime(SYNCED_AT));
      s.dispatch(setSyncStatus('success'));
    },
    name: 'Sync now',
    description: `Manual sync\n${WHEN}`,
    tooltip: `Manual sync · ${WHEN}`,
    dimmed: false,
  },
  {
    // Worst path: the glyph says synced but no time was stored. Nothing to
    // say when, so the action line stays.
    state: 'synced, no time recorded',
    seed: (s) => {
      ready(s);
      s.dispatch(setSyncStatus('success'));
    },
    name: 'Sync now',
    description: 'Cloud sync on',
    tooltip: 'Cloud sync on · Sync now',
    dimmed: false,
  },
  {
    // An edit here hasn't reached the cloud (the `sync` glyph), so "Sync now"
    // is true, even with an earlier sync's time on record.
    state: 'not synced yet, an earlier time on record',
    seed: (s) => {
      ready(s);
      s.dispatch(setLastSyncedTime(SYNCED_AT));
      s.dispatch(setSyncStatus('idle'));
    },
    name: 'Sync now',
    description: 'Cloud sync on',
    tooltip: 'Cloud sync on · Sync now',
    dimmed: false,
  },
  {
    // KAN-750 R8b. Auto Sync's boot sync is committed and waits for sign-in:
    // "Syncing…" at once, as the sync itself will be, until its 8 s limit.
    state: 'boot sync waiting for sign-in',
    seed: (s) => {
      s.dispatch(setSignedIn());
      s.dispatch(setCloudConfigured(true));
      s.dispatch(grantCloudConsent());
    },
    name: 'Syncing…',
    description: null,
    tooltip: 'Syncing…',
    dimmed: true,
  },
  {
    // A Sync now press with Auto Sync off. Dimmed because a sync is running,
    // so that is what the name says (Justine's pick, 2026-09-29).
    state: 'manual, mid-sync',
    seed: (s) => {
      ready(s);
      s.dispatch(toggleAutoSync());
      s.dispatch(setSyncStatus('loading'));
    },
    name: 'Syncing…',
    description: null,
    tooltip: 'Syncing…',
    dimmed: true,
  },
  {
    // Only a PR CI build has no cloud. The button stays clickable there
    // (ruled 2026-09-29), so the card's "unavailable" becomes the
    // description of a working button. Pinned so a change is deliberate.
    state: 'no cloud (PR CI builds)',
    seed: (s) => {
      s.dispatch(setSignedIn());
      s.dispatch(grantCloudConsent());
    },
    name: 'Sync now',
    description: 'Sync unavailable',
    tooltip: 'Sync unavailable · Sync now',
    dimmed: false,
  },
];

const renderMenu = (seed: (store: Store) => void) =>
  renderWithProviders(<MenuContainer />, { seedStore: seed });

/**
 * The words the rendered sync button uses for the state: its description's
 * first line when it is clickable (a second line may say when it synced), its
 * name when it is dimmed.
 */
function renderedStateWords(): string | null {
  const button = screen
    .getAllByRole('button')
    .find((b) => b.querySelector('[data-glyph]') !== null);
  if (button === undefined) throw new Error('no sync button in the header');
  const description = button.getAttribute('aria-description');
  // Empty on a dimmed button: its name is the state (KAN-345).
  return description
    ? description.split('\n')[0]
    : button.getAttribute('aria-label');
}

/** The Sync & Backup card's title key for the store's current facts. */
function cardTitle(store: Store): string {
  const { globalState, settingsDataState } = store.getState();
  return describeSyncState({
    isSignedIn: globalState.isSignedIn,
    awaitsDeviceId: globalState.awaitsDeviceId,
    hasReadDeviceId: globalState.hasReadDeviceId,
    isAutoSync: settingsDataState.isAutoSync,
    isCloudConfigured: globalState.isCloudConfigured,
    cloudConsent: settingsDataState.cloudConsent,
    syncStatus: globalState.syncStatus,
    isCloudDeletedElsewhere: settingsDataState.cloudDeletedElsewhere !== null,
  }).title;
}

describe('the header sync button says what is true (KAN-342)', () => {
  test.each(CASES)(
    '$state: named "$name"',
    async ({ seed, name, description, tooltip, dimmed }) => {
      await renderMenu(seed);

      const button = screen.getByRole('button', { name });
      expect({
        description: button.getAttribute('aria-description'),
        tooltip: button.getAttribute('data-tooltip'),
        dimmed: button.getAttribute('aria-disabled') === 'true',
      }).toEqual({ description, tooltip, dimmed });
    }
  );

  // The words must be the card's, for the same facts. Read from what the
  // header RENDERS, found by its glyph rather than its name, so a state renamed
  // in describeSyncState can't leave the header saying the old thing.
  test.each(
    CASES.filter(
      (c) =>
        c.state !== 'manual, mid-sync' &&
        c.state !== 'boot sync waiting for sign-in'
    )
  )(
    '$state: the header says what the Sync & Backup card says',
    async ({ seed }) => {
      const { store } = await renderMenu(seed);

      expect(renderedStateWords()).toBe(testI18n.t(cardTitle(store)));
    }
  );

  // The places the two disagree, on purpose.
  test('boot sync waiting: the card says the setting until the drawing shows the sync, the button says Syncing…', async () => {
    const boot = CASES.find((c) => c.state === 'boot sync waiting for sign-in');
    if (boot === undefined) throw new Error('no boot wait case');
    const { store } = await renderMenu(boot.seed);

    expect(cardTitle(store)).toBe('Cloud sync on');
    expect(renderedStateWords()).toBe('Syncing…');
  });

  test('manual, mid-sync: the card describes the setting, the button what it is doing', async () => {
    const manualMidSync = CASES.find((c) => c.state === 'manual, mid-sync');
    if (manualMidSync === undefined)
      throw new Error('no manual, mid-sync case');
    const { store } = await renderMenu(manualMidSync.seed);

    expect(cardTitle(store)).toBe('Manual sync');
    expect(renderedStateWords()).toBe('Syncing…');
  });

  test('a description belongs only to a control', () => {
    // A presentational Icon is aria-hidden, so a description would describe
    // nothing. The type rules it out, like ariaLabel.
    // @ts-expect-error -- no onClick, so no ariaDescription
    const decoration = <Icon type="sync" ariaDescription="Sync is off" />;
    expect(decoration).toBeTruthy();
  });
});
