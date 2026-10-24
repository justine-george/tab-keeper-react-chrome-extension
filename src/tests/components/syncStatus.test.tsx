import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { syncPressedAt } from '../../components/common/useShownSyncStatus';
import { MORPH_MS, morphPath } from '../../components/common/syncMotion';
import {
  SYNC_PROBLEM_HALF_TURN,
  SYNC_PROBLEM_PATH,
} from '../../components/common/syncMorph.data';
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
  deviceIdReadFinished,
  saveToFirestoreIfDirty,
  setCloudConfigured,
  setLoggedOut,
  setSignedIn,
  setSyncStatus,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  CHALK_THEME,
  CHARCOAL_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';
import { getTooltipDate } from '../../utils/functions/local';
import { asWritten } from '../setup/asWritten';

// KAN-248. The sync status card said "Cloud Sync Active" whenever a token
// existed -- under an Auto Sync button reading Off, and after a failed sync
// while the header showed sync_problem. The header derives its icon from
// isSignedIn and then syncStatus (MenuContainer, KAN-79); the card was the
// same fact drawn from less information, one screen away.
//
// The card now derives from the same inputs, in an order that makes each
// state true: no token -> unavailable; last result error, with a cloud ->
// failed (KAN-346: a Sync now press can fail with Auto Sync off); auto sync
// off -> manual (nothing is sent until the cloud button is pressed); no cloud
// in this build -> unavailable (KAN-147: PR CI builds without one, and "on"
// there would be a lie); else on.

const base = {
  isSignedIn: true,
  awaitsDeviceId: false,
  hasReadDeviceId: true,
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
  });

  // KAN-750 R13b. "On" draws the done cloud only once a sync has landed;
  // before one, or after an edit, the still arrows, as the header draws them.
  test('on draws the done cloud after a landed sync, still arrows otherwise', () => {
    expect(describeSyncState({ ...base, syncStatus: 'success' }).icon).toBe(
      'cloud_done'
    );
    const idle = describeSyncState({ ...base, syncStatus: 'idle' });
    expect(idle.icon).toBe('sync');
    expect(idle.kind).toBe('on');
    expect(idle.title).toBe('Cloud sync on');
  });

  // KAN-261. A write in flight is neither "on" nor "failed" yet, and the user
  // who just pressed Merge or Replace is looking at this card, not at the
  // header's cloud glyph. Same glyph as the header uses for the same state.
  test("a sync in flight is syncing, with the header's in-flight glyph", () => {
    const syncing = describeSyncState({ ...base, syncStatus: 'loading' });
    expect(syncing.kind).toBe('syncing');
    expect(syncing.icon).toBe('sync');
    expect(syncing.title).toBe('Syncing…');
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

  // KAN-346. Auto Sync off stops the AUTOMATIC sync, not a Sync now press. A
  // failed press read "Manual sync", under the header's sync_problem glyph.
  test('a failed manual sync is failed, not manual (KAN-346)', () => {
    expect(
      describeSyncState({ ...base, isAutoSync: false, syncStatus: 'error' })
        .kind
    ).toBe('failed');
  });

  // Without a cloud every call throws cloudUnavailable, which is not a failed
  // sync: a cloudless build (PR CI) keeps saying what it said before.
  test('without a cloud, an error is not a failed sync (KAN-346)', () => {
    expect(
      describeSyncState({
        ...base,
        isCloudConfigured: false,
        isAutoSync: false,
        syncStatus: 'error',
      }).kind
    ).toBe('manual');
    expect(
      describeSyncState({
        ...base,
        isCloudConfigured: false,
        syncStatus: 'error',
      }).kind
    ).toBe('unavailable');
  });

  test('no token is unavailable, whatever else is true', () => {
    expect(
      describeSyncState({ ...base, isSignedIn: false, syncStatus: 'error' })
        .kind
    ).toBe('unavailable');
  });

  // KAN-750 R19. Signed out before the open's read lands is "not read yet": described as signed in.
  test('no token before the stored id is read is not unavailable', () => {
    const unread = { ...base, isSignedIn: false, hasReadDeviceId: false };
    expect(describeSyncState(unread).kind).toBe('on');
    expect(describeSyncState(unread).icon).toBe('sync');
    expect(describeSyncState({ ...unread, cloudConsent: '' }).kind).toBe('off');
  });

  // KAN-599. A fresh install holds no id until the yes; that is off, not unavailable.
  test('no id yet, awaiting the yes, is off; with the yes it is not unavailable either', () => {
    const awaiting = { ...base, isSignedIn: false, awaitsDeviceId: true };
    expect(
      describeSyncState({ ...awaiting, cloudConsent: 'declined' }).kind
    ).toBe('off');
    expect(describeSyncState({ ...awaiting, cloudConsent: '' }).kind).toBe(
      'off'
    );
    expect(describeSyncState(awaiting).kind).toBe('on');
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
      describeSyncState({ ...base, syncStatus: 'success' }),
      describeSyncState({ ...base, isAutoSync: false }),
      describeSyncState({
        ...base,
        cloudConsent: 'declined',
        isAutoSync: false,
      }),
      describeSyncState({ ...base, syncStatus: 'error' }),
      describeSyncState({ ...base, syncStatus: 'loading' }),
      describeSyncState({ ...base, isSignedIn: false }),
    ];
    // Off and manual share the cloud glyph -- both are "not sending" -- and
    // differ in title; every other state has its own glyph.
    expect(new Set(kinds.map((k) => k.title)).size).toBe(6);
    expect(new Set(kinds.map((k) => k.icon)).size).toBe(5);
  });
});

const renderSync = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SYNC));
      store.dispatch(setSignedIn());
      store.dispatch(setCloudConfigured(true));
      store.dispatch(grantCloudConsent());
      // The boot sync has run, so the card is not waiting for it (KAN-750).
      store.dispatch(syncStateWithFirestore.pending('boot', undefined));
      store.dispatch(setSyncStatus('idle'));
    },
  });

// KAN-750. An unpressed sync shows after 150 ms and stays 400 ms.
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
beforeEach(() => {
  syncPressedAt.current = -Infinity;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const card = () => screen.getByTestId('sync-status');

describe('the sync status line follows the store (KAN-248)', () => {
  test('auto sync on, cloud: "Cloud sync on"', async () => {
    await renderSync();
    expect(card().textContent).toContain('Cloud sync on');
  });

  // KAN-261. The write after Merge/Replace runs while the user is on this
  // pane; the card says so, then says how it went, in step with the toast.
  test('the card follows a cloud write: syncing, then on or failed', async () => {
    const { store } = await renderSync();
    expect(card().textContent).toContain('Cloud sync on');

    act(() => {
      store.dispatch({ type: saveToFirestoreIfDirty.pending.type });
    });
    await advance(150);
    expect(card().textContent).toContain('Syncing…');
    expect(card().textContent).not.toContain('Cloud sync on');

    act(() => {
      store.dispatch({ type: saveToFirestoreIfDirty.rejected.type });
    });
    await advance(400);
    expect(card().textContent).toContain('Last sync failed');

    act(() => {
      store.dispatch({ type: saveToFirestoreIfDirty.pending.type });
    });
    await advance(150);
    expect(card().textContent).toContain('Syncing…');
    act(() => {
      store.dispatch({ type: saveToFirestoreIfDirty.fulfilled.type });
    });
    await advance(400);
    expect(card().textContent).toContain('Cloud sync on');
  });

  // KAN-263. A sync is read-then-write; the test above only covers the write.
  // The card said "Cloud sync on" through the whole cloud read and switched
  // to Syncing… only when the write began, which is what Justine saw after
  // Undo. A read that fails outright must land on failed, not on "on".
  test('the card follows the READ phase of a sync too: syncing, then failed', async () => {
    const { store } = await renderSync();
    expect(card().textContent).toContain('Cloud sync on');

    act(() => {
      store.dispatch(syncStateWithFirestore.pending('read-phase', undefined));
    });
    await advance(150);
    expect(card().textContent).toContain('Syncing…');
    expect(card().textContent).not.toContain('Cloud sync on');

    act(() => {
      store.dispatch(
        syncStateWithFirestore.rejected(
          new Error('offline'),
          'read-phase',
          undefined
        )
      );
    });
    await advance(400);
    expect(card().textContent).toContain('Last sync failed');
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

  test('a failed manual sync says it failed (KAN-346)', async () => {
    const { store } = await renderSync();
    act(() => {
      store.dispatch(toggleAutoSync());
      store.dispatch(setSyncStatus('error'));
    });
    expect(card().textContent).toContain('Last sync failed');
    expect(card().textContent).not.toContain('Manual sync');
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

  // KAN-650. A wide full view ran the sentence the whole pane; it stops at
  // the reading width of the other Settings help lines.
  test('the sentence stops at the settings reading width', async () => {
    const { store } = await renderSync();
    act(() => {
      store.dispatch(declineCloudConsent());
    });
    const line = card().querySelector<HTMLElement>('[data-sync-line]');
    if (line === null) throw new Error('no sync sentence');
    // 36rem; jsdom resolves it against its 16px root.
    expect(getComputedStyle(line).maxWidth).toBe('576px');
  });

  test('no token: unavailable', async () => {
    const { store } = await renderSync();
    act(() => {
      store.dispatch(setLoggedOut());
      store.dispatch(deviceIdReadFinished());
    });
    expect(card().textContent).toContain('Sync unavailable');
  });

  // KAN-750 R19. The card says the same as the button while the stored id is unread.
  test('before the stored id is read, the card is not unavailable', async () => {
    const { store } = await renderWithProviders(<SettingsDetailsContainer />, {
      seedStore: (s) => {
        s.dispatch(selectCategory(SettingsCategory.SYNC));
        s.dispatch(setCloudConfigured(true));
        s.dispatch(grantCloudConsent());
      },
    });
    expect(card().getAttribute('data-sync-state')).toBe('on');
    expect(
      card().querySelector('[data-glyph]')?.getAttribute('data-glyph')
    ).toBe('sync');

    act(() => {
      store.dispatch(setLoggedOut());
      store.dispatch(deviceIdReadFinished());
    });
    expect(card().getAttribute('data-sync-state')).toBe('unavailable');
    expect(card().textContent).toContain('Sync unavailable');
  });

  test('the body line is LABEL_L1, and that clears 4.5:1 on every theme', async () => {
    await renderSync();
    const line = card().querySelector<HTMLElement>('[data-sync-line]')!;
    expect(line).not.toBeNull();
    expect(getComputedStyle(line).color).toMatch(
      asWritten(LIGHT_THEME.LABEL_L1_COLOR)
    );

    // The token was LABEL_L3 -- the 2px-marker token, 2.56:1 on Paper. This
    // is why L1 and not L2: L2 clears 4.5 on three of the five themes only.
    for (const theme of [
      LIGHT_THEME,
      WARM_LIGHT_THEME,
      BB_PINK_THEME,
      DARKENHEIMER_THEME,
      BLUE_THEME,
      CHALK_THEME,
      CHARCOAL_THEME,
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
      { ...base, syncStatus: 'loading' as const },
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
    expect(line?.textContent).toMatch(/^Last synced \S/);
    // The full timestamp is the hover (KAN-584; the words are pinned in
    // lastSyncedDate.test.tsx).
    expect(line?.getAttribute('data-tooltip')).toBe(
      getTooltipDate(AT, 'en', 'h12')
    );
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
      store.dispatch(deviceIdReadFinished());
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

// KAN-750. The card's icon and title follow the SHOWN status, drawn with the
// button's glyph; the two share one press ref so they never disagree.
describe('the card follows the shown sync status (KAN-750)', () => {
  const glyphOf = (root: HTMLElement) => {
    const g = root.querySelector('[data-glyph]');
    return {
      glyph: g?.getAttribute('data-glyph'),
      turning: g?.getAttribute('data-turning'),
    };
  };
  test('the card turns while the button would, and shows done after the hold', async () => {
    const { store } = await renderSync();
    expect(glyphOf(card())).toEqual({ glyph: 'sync', turning: 'false' });

    await act(async () => {
      store.dispatch(setSyncStatus('loading'));
    });
    // Unpressed: title and icon wait for the delay together.
    await advance(149);
    expect(card().textContent).toContain('Cloud sync on');
    expect(glyphOf(card()).turning).toBe('false');
    await advance(1);
    expect(card().textContent).toContain('Syncing…');
    expect(glyphOf(card())).toEqual({ glyph: 'sync', turning: 'true' });

    await act(async () => {
      store.dispatch(setSyncStatus('success'));
    });
    // Held for HOLD_MS after it was shown, then done.
    await advance(399);
    expect(glyphOf(card()).turning).toBe('true');
    await advance(1);
    expect(card().textContent).toContain('Cloud sync on');
    expect(glyphOf(card())).toEqual({ glyph: 'cloud_done', turning: 'false' });
  });

  // KAN-750 r3 (B). The card shares SyncGlyph, so a failure morphs there too.
  test('"Last sync failed" arrives by morph: the turning arrows grow a "!"', async () => {
    const { store } = await renderSync();
    await act(async () => {
      store.dispatch(setSyncStatus('loading'));
    });
    await advance(150);
    expect(glyphOf(card())).toEqual({ glyph: 'sync', turning: 'true' });

    await act(async () => {
      store.dispatch(setSyncStatus('error'));
    });
    await advance(400);
    expect(card().textContent).toContain('Last sync failed');
    expect(glyphOf(card())).toEqual({
      glyph: 'sync_problem',
      turning: 'false',
    });
    const root = card().querySelector('[data-glyph]');
    const d = () =>
      [...(root?.querySelectorAll('path') ?? [])].map((p) =>
        p.getAttribute('d')
      );
    // One layer, morphing (no turn to read here, so it settles a half turn round).
    expect(root?.childElementCount).toBe(1);
    expect(d()).toEqual([morphPath(SYNC_PROBLEM_HALF_TURN, 0)]);
    await advance(MORPH_MS);
    expect(d()).toEqual([SYNC_PROBLEM_PATH]);
  });

  test('the button and the card show the same glyph at the click, at 150 ms and after the hold', async () => {
    const { store } = await renderWithProviders(
      <>
        <MenuContainer />
        <SettingsDetailsContainer />
      </>,
      {
        seedStore: (s) => {
          s.dispatch(selectCategory(SettingsCategory.SYNC));
          s.dispatch(setSignedIn());
          s.dispatch(setCloudConfigured(true));
          s.dispatch(grantCloudConsent());
          s.dispatch(syncStateWithFirestore.pending('boot', undefined));
          s.dispatch(setSyncStatus('idle'));
        },
      }
    );
    const button = () =>
      screen.getByRole('button', { name: /^Sync now|Syncing…$/ });
    const same = () => {
      expect(glyphOf(card())).toEqual(glyphOf(button()));
      return glyphOf(card());
    };
    // The fake clock is frozen at mount; a press needs to come after it.
    await advance(1);
    // One synchronous act, as in a real click: the press then the load.
    act(() => {
      fireEvent.click(button());
      store.dispatch(setSyncStatus('loading'));
    });
    expect(same()).toEqual({ glyph: 'sync', turning: 'true' });
    await advance(150);
    expect(same().turning).toBe('true');
    await act(async () => {
      store.dispatch(setSyncStatus('success'));
    });
    await advance(400);
    expect(same()).toEqual({ glyph: 'cloud_done', turning: 'false' });

    // KAN-750 R13b. An edit after the sync (markDirty sets 'idle'): both
    // turn back into the still arrows, nothing claims a sync that did not land.
    await act(async () => {
      store.dispatch(setSyncStatus('idle'));
    });
    await advance(MORPH_MS);
    expect(same()).toEqual({ glyph: 'sync', turning: 'false' });
  });

  // KAN-750 R13b. Offline: the boot sync never starts. At the 8 s limit the
  // card stops turning on still arrows; it does not morph into the done cloud.
  test('a boot sync that never lands stops on still arrows at 8 s', async () => {
    await renderWithProviders(<SettingsDetailsContainer />, {
      seedStore: (s) => {
        s.dispatch(selectCategory(SettingsCategory.SYNC));
        s.dispatch(setSignedIn());
        s.dispatch(setCloudConfigured(true));
        s.dispatch(grantCloudConsent());
      },
    });
    await advance(7999);
    expect(glyphOf(card())).toEqual({ glyph: 'sync', turning: 'true' });
    await advance(1);
    expect(glyphOf(card())).toEqual({ glyph: 'sync', turning: 'false' });
    expect(card().textContent).toContain('Cloud sync on');
    await advance(MORPH_MS);
    expect(glyphOf(card()).glyph).toBe('sync');
  });
});
