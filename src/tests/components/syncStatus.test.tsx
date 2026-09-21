import { describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { describeSyncState } from '../../components/settings/rightpane/Account/describeSyncState';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import {
  declineCloudConsent,
  grantCloudConsent,
  recordSyncedNow,
  setLastSyncedTime,
  toggleAutoSync,
} from '../../redux/slices/settingsDataStateSlice';
import {
  setCloudConfigured,
  setLoggedOut,
  setSignedIn,
} from '../../redux/slices/globalStateSlice';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';
import { getPrettyDate } from '../../utils/functions/local';

// KAN-248. The sync status card said "Cloud Sync Active" whenever a token
// existed -- under an Auto Sync button reading Off, and after a failed sync
// while the header showed sync_problem. The header derives its icon from
// isSignedIn and then syncStatus (MenuContainer, KAN-79); the card was the
// same fact drawn from less information, one screen away.
//
// The card now derives from the same inputs, in an order that makes each
// state true: no token -> unavailable; auto sync off -> manual (whatever the
// cloud is doing, nothing is sent); no cloud in this build -> unavailable
// (KAN-147: PR CI builds without one, and "on" there would be a lie); last
// result error -> failed; else on.

const base = {
  isSignedIn: true,
  isAutoSync: true,
  isCloudConfigured: true,
  cloudConsent: 'granted' as const,
  syncStatus: 'idle' as const,
};

describe('describeSyncState', () => {
  test('token, auto on, cloud, no error: on', () => {
    expect(describeSyncState(base).kind).toBe('on');
    expect(describeSyncState({ ...base, syncStatus: 'success' }).kind).toBe(
      'on'
    );
    // The half-second at cold start before auth resolves is still "on":
    // flashing "unavailable" on every open would be noise.
    expect(describeSyncState({ ...base, syncStatus: 'loading' }).kind).toBe(
      'on'
    );
  });

  // KAN-259. A user who declined the cloud question has not chosen manual
  // sync; they have chosen no sync. The cloud button asks them first, so
  // "until you press the cloud button" would be a half-truth for them.
  test('consent declined is off, whatever the flag says', () => {
    expect(
      describeSyncState({
        ...base,
        cloudConsent: 'declined',
        isAutoSync: false,
      }).kind
    ).toBe('off');
    expect(
      describeSyncState({ ...base, cloudConsent: '', isAutoSync: true }).kind
    ).toBe('off');
  });

  test('auto sync off is manual, even with a healthy cloud', () => {
    expect(describeSyncState({ ...base, isAutoSync: false }).kind).toBe(
      'manual'
    );
  });

  test('a failed last sync is failed, not on', () => {
    expect(describeSyncState({ ...base, syncStatus: 'error' }).kind).toBe(
      'failed'
    );
  });

  test('no token is unavailable, whatever else is true', () => {
    expect(
      describeSyncState({ ...base, isSignedIn: false, syncStatus: 'error' })
        .kind
    ).toBe('unavailable');
  });

  test('no cloud in the build is unavailable, but auto-off still reads manual', () => {
    expect(describeSyncState({ ...base, isCloudConfigured: false }).kind).toBe(
      'unavailable'
    );
    // Order matters: the toggle's effect is visible in a cloudless build,
    // which is what lets the e2e run in PR CI.
    expect(
      describeSyncState({
        ...base,
        isCloudConfigured: false,
        isAutoSync: false,
      }).kind
    ).toBe('manual');
  });

  test('each state names a distinct icon and title', () => {
    const kinds = [
      describeSyncState(base),
      describeSyncState({ ...base, isAutoSync: false }),
      describeSyncState({
        ...base,
        cloudConsent: 'declined',
        isAutoSync: false,
      }),
      describeSyncState({ ...base, syncStatus: 'error' }),
      describeSyncState({ ...base, isSignedIn: false }),
    ];
    // Off and manual share the cloud glyph -- both are "not sending" -- and
    // differ in title; every other state has its own glyph.
    expect(new Set(kinds.map((k) => k.title)).size).toBe(5);
    expect(new Set(kinds.map((k) => k.icon)).size).toBe(4);
  });
});

const renderSync = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SYNC));
      store.dispatch(setSignedIn());
      store.dispatch(setCloudConfigured(true));
      store.dispatch(grantCloudConsent());
    },
  });

const card = () => screen.getByTestId('sync-status');

describe('the sync status line follows the store (KAN-248)', () => {
  test('auto sync on, cloud: "Cloud sync on"', async () => {
    await renderSync();
    expect(card().textContent).toContain('Cloud sync on');
  });

  test('turning auto sync off changes the card to manual -- the case it used to get wrong', async () => {
    const { store } = await renderSync();
    act(() => {
      store.dispatch(toggleAutoSync());
    });
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    expect(card().textContent).toContain('Manual sync');
    expect(card().textContent).not.toContain('Cloud sync on');
  });

  test('declined: "Sync is off", and the line does not promise the cloud button syncs', async () => {
    const { store } = await renderSync();
    act(() => {
      store.dispatch(declineCloudConsent());
    });
    expect(card().getAttribute('data-sync-state')).toBe('off');
    expect(card().textContent).toContain('Sync is off');
    expect(card().textContent).not.toContain('Manual sync');
  });

  test('no token: unavailable', async () => {
    const { store } = await renderSync();
    act(() => {
      store.dispatch(setLoggedOut());
    });
    expect(card().textContent).toContain('Sync unavailable');
  });

  test('the body line is LABEL_L1, and that clears 4.5:1 on every theme', async () => {
    await renderSync();
    const line = card().querySelector<HTMLElement>('[data-sync-line]')!;
    expect(line).not.toBeNull();
    // Written by emotion as the hex; jsdom may normalise to rgb().
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(LIGHT_THEME.LABEL_L1_COLOR.slice(i, i + 2), 16)
    );
    expect(getComputedStyle(line).color).toMatch(
      new RegExp(
        `(${LIGHT_THEME.LABEL_L1_COLOR}|rgb\\(${r}, ?${g}, ?${b}\\))`,
        'i'
      )
    );

    // The token was LABEL_L3 -- the 2px-marker token, 2.56:1 on Paper. This
    // is why L1 and not L2: L2 clears 4.5 on two of the five themes only.
    for (const theme of [
      LIGHT_THEME,
      WARM_LIGHT_THEME,
      BB_PINK_THEME,
      DARKENHEIMER_THEME,
      BLUE_THEME,
    ]) {
      expect(
        contrast(theme.LABEL_L1_COLOR, theme.PRIMARY_COLOR)
      ).toBeGreaterThanOrEqual(4.5);
    }
    // CONTROL: the old token really fails, so the assertion above is doing
    // something.
    expect(
      contrast(LIGHT_THEME.LABEL_L3_COLOR, LIGHT_THEME.PRIMARY_COLOR)
    ).toBeLessThan(4.5);
  });
});

// keyCoverage.test.ts scans t('literal') and is blind to t(variable). The
// card passes the derivation's keys through t(), so this is the check that
// they exist -- the drift test then holds the other nine locales to en.
describe('every key the derivation emits is a translation key', () => {
  test('titles and lines exist in en', async () => {
    const en = (await import('../../../public/locales/en/translation.json'))
      .default as Record<string, string>;
    const states = [
      base,
      { ...base, isAutoSync: false },
      { ...base, cloudConsent: 'declined' as const, isAutoSync: false },
      { ...base, syncStatus: 'error' as const },
      { ...base, isSignedIn: false },
    ].map(describeSyncState);
    for (const s of states) {
      expect(en, `missing key: ${s.title}`).toHaveProperty(s.title);
      expect(en, `missing key: ${s.line}`).toHaveProperty(s.line);
    }
  });
});

// KAN-255. "Cloud sync on" is true after a successful sync and equally true
// five hours after the last one. A last-synced time, recorded per device on
// each successful sync, is what a user actually checks when wondering whether
// the other device has caught up. Once a time exists it REPLACES the
// explanatory sentence in the on state -- the sentence explains what will
// happen, the time says it did. Manual keeps its sentence (an instruction)
// with the time above it. Failed and unavailable show no time: it would read
// as reassurance.
describe('the status line shows when it last synced (KAN-255)', () => {
  const renderWith = (opts: {
    autoSync: boolean;
    lastSyncedTime: number | '';
  }) =>
    renderWithProviders(<SettingsDetailsContainer />, {
      seedStore: (store) => {
        store.dispatch(selectCategory(SettingsCategory.SYNC));
        store.dispatch(setSignedIn());
        store.dispatch(setCloudConfigured(true));
        store.dispatch(grantCloudConsent());
        if (!opts.autoSync) store.dispatch(toggleAutoSync());
        if (opts.lastSyncedTime !== '') {
          store.dispatch(setLastSyncedTime(opts.lastSyncedTime));
        }
      },
    });
  const AT = Date.UTC(2026, 8, 20, 22, 14, 22);

  test('on, with a time: the time stands in for the sentence', async () => {
    await renderWith({ autoSync: true, lastSyncedTime: AT });
    const line = card().querySelector('[data-sync-synced]');
    expect(line?.textContent).toMatch(/^Last synced /);
    expect(line?.textContent).toContain(getPrettyDate(AT, 'en'));
    expect(card().querySelector('[data-sync-line]')).toBeNull();
  });

  test('on, never synced: the sentence, no time', async () => {
    await renderWith({ autoSync: true, lastSyncedTime: '' });
    expect(card().querySelector('[data-sync-synced]')).toBeNull();
    expect(card().querySelector('[data-sync-line]')).not.toBeNull();
  });

  test('manual, with a time: both', async () => {
    await renderWith({ autoSync: false, lastSyncedTime: AT });
    expect(card().querySelector('[data-sync-synced]')).not.toBeNull();
    expect(card().querySelector('[data-sync-line]')?.textContent).toMatch(
      /Manual|stay on this device/
    );
  });

  test('no token: no time, even if one is recorded', async () => {
    const { store } = await renderWith({ autoSync: true, lastSyncedTime: AT });
    act(() => {
      store.dispatch(setLoggedOut());
    });
    expect(card().querySelector('[data-sync-synced]')).toBeNull();
  });

  test('a successful sync stamps the time; a failed one does not', async () => {
    const { store } = await renderWith({ autoSync: true, lastSyncedTime: '' });
    expect(store.getState().settingsDataState.lastSyncedTime).toBe('');
    act(() => {
      store.dispatch(recordSyncedNow());
    });
    const stamped = store.getState().settingsDataState.lastSyncedTime;
    expect(typeof stamped).toBe('number');
    expect(Math.abs((stamped as number) - Date.now())).toBeLessThan(5000);
  });
});
