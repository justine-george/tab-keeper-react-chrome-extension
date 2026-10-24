import { describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import {
  declineCloudConsent,
  grantCloudConsent,
  toggleAutoSync,
} from '../../redux/slices/settingsDataStateSlice';
import {
  deviceIdReadFinished,
  setCloudConfigured,
  setLoggedOut,
  setSignedIn,
  setSyncStatus,
} from '../../redux/slices/globalStateSlice';
import {
  replaceState,
  saveToTabContainerInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  estimateFirestoreBytes,
  FIRESTORE_MAX_DOCUMENT_BYTES,
} from '../../utils/functions/local';
import { formatSyncUsed } from '../../utils/functions/syncSpace';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  BLUE_THEME,
  LIGHT_THEME,
  ThemeColorsOverride,
} from '../../hooks/useThemeColors';
import { rgb } from '../setup/hexColor';

// KAN-596. How much of the 1 MB the sync may write, under Sync Status.

// One session whose single tab's address pads the container to about `bytes`.
const containerOf = (bytes: number) => {
  const base = buildSession({ tabGroupId: 'big' });
  const tab = base.windows[0].tabs[0];
  const pad = Math.max(
    0,
    bytes - estimateFirestoreBytes(buildContainer([base]))
  );
  return buildContainer([
    {
      ...base,
      windows: [
        {
          ...base.windows[0],
          tabs: [{ ...tab, url: `${tab.url}${'a'.repeat(pad)}` }],
        },
      ],
    },
  ]);
};

const renderSync = (bytes?: number, theme = LIGHT_THEME) =>
  renderWithProviders(
    <ThemeColorsOverride.Provider value={theme}>
      <SettingsDetailsContainer />
    </ThemeColorsOverride.Provider>,
    {
      seedStore: (store) => {
        if (bytes !== undefined)
          store.dispatch(replaceState(containerOf(bytes)));
        store.dispatch(selectCategory(SettingsCategory.SYNC));
        store.dispatch(setSignedIn());
        store.dispatch(setCloudConfigured(true));
        store.dispatch(grantCloudConsent());
      },
    }
  );

// KAN-625. Named for what it measures: the sessions here against the sync limit, not cloud storage.
const meter = () => screen.queryByRole('meter', { name: 'Sync limit used' });
const fill = () => meter()?.firstElementChild as HTMLElement | null;
const fillColor = () => getComputedStyle(fill() as HTMLElement).backgroundColor;
const line = () => screen.getByTestId('sync-space').textContent;

describe('the sync space bar (KAN-596)', () => {
  test('reads exactly what the sync measures before it writes, and follows the sessions', async () => {
    const { store } = await renderSync();
    const used = () =>
      estimateFirestoreBytes(store.getState().tabContainerDataState);
    expect(line()).toBe(
      `Your sessions use ${formatSyncUsed(used(), 'en')} of the 1 MB sync limit.`
    );
    expect(meter()?.getAttribute('aria-valuenow')).toBe(
      String(Math.round((used() / FIRESTORE_MAX_DOCUMENT_BYTES) * 100))
    );

    const before = used();
    act(() => {
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({
            tabGroupId: 'more',
            title: '東京旅行の計画'.repeat(200),
          })
        )
      );
    });
    expect(used()).toBeGreaterThan(before);
    expect(line()).toBe(
      `Your sessions use ${formatSyncUsed(used(), 'en')} of the 1 MB sync limit.`
    );
  });

  test('from 80% it warns; past the limit it says the sessions are too large to sync', async () => {
    await renderSync(Math.ceil(FIRESTORE_MAX_DOCUMENT_BYTES * 0.85));
    expect(screen.getByTestId('sync-space').dataset.level).toBe('near');
    expect(line()).toMatch(
      / of the 1 MB sync limit\. Sync stops at 1 MB: delete sessions you no longer need\.$/
    );
  });

  test('past the limit the fill stops at full', async () => {
    await renderSync(FIRESTORE_MAX_DOCUMENT_BYTES + 50_000);
    expect(screen.getByTestId('sync-space').dataset.level).toBe('full');
    expect(line()).toMatch(
      /^Your sessions use 1\.\d MB of the 1 MB sync limit\. Too large to sync: delete sessions you no longer need\.$/
    );
    expect(meter()?.getAttribute('aria-valuenow')).toBe('100');
    expect(fill()?.style.width).toBe('100%');
  });

  // KAN-725. The warning fill is the destructive mark colour, per theme.
  test('from 80% the fill is DANGER_MARK, in a light theme and a dark one', async () => {
    const view = await renderSync(
      Math.ceil(FIRESTORE_MAX_DOCUMENT_BYTES * 0.85)
    );
    expect(fillColor()).toBe(rgb(LIGHT_THEME.DANGER_MARK));
    view.unmount();
    await renderSync(
      Math.ceil(FIRESTORE_MAX_DOCUMENT_BYTES * 0.85),
      BLUE_THEME
    );
    expect(fillColor()).toBe(rgb(BLUE_THEME.DANGER_MARK));
    expect(fillColor()).toBe('rgb(255, 156, 148)');
  });

  test('CONTROL: with room to spare the fill stays LABEL_L2_COLOR', async () => {
    await renderSync(Math.floor(FIRESTORE_MAX_DOCUMENT_BYTES * 0.5));
    expect(screen.getByTestId('sync-space').dataset.level).toBe('ok');
    expect(fillColor()).toBe(rgb(LIGHT_THEME.LABEL_L2_COLOR));
  });

  // KAN-625. 1 kB is 0.1% of 1 MB: rounded to whole percent it drew nothing while the line said 1 kB.
  test('a small use fills its exact share, never less than a 3px sliver', async () => {
    const { store } = await renderSync(1024);
    const used = estimateFirestoreBytes(store.getState().tabContainerDataState);
    expect(used / FIRESTORE_MAX_DOCUMENT_BYTES).toBeLessThan(0.005);
    expect(fill()?.style.width).toBe(
      `${(used / FIRESTORE_MAX_DOCUMENT_BYTES) * 100}%`
    );
    expect(fill()?.style.minWidth).toBe('3px');
  });

  test('with no sessions the line reads 0 kB and the bar draws no sliver: both round the same way', async () => {
    const { store } = await renderSync();
    act(() => {
      store.dispatch(replaceState(buildContainer([])));
    });
    // PREMISE: an empty list still writes its frame, so the bytes are not 0.
    expect(
      estimateFirestoreBytes(store.getState().tabContainerDataState)
    ).toBeGreaterThan(0);
    expect(line()).toBe('Your sessions use 0 kB of the 1 MB sync limit.');
    expect(fill()?.style.minWidth).toBe('');
  });

  test('shown whenever this device syncs: manual, failed and syncing too', async () => {
    const { store } = await renderSync();
    act(() => {
      store.dispatch(toggleAutoSync());
    });
    expect(meter()).not.toBeNull();
    act(() => {
      store.dispatch(setSyncStatus('error'));
    });
    expect(meter()).not.toBeNull();
    act(() => {
      store.dispatch(setSyncStatus('loading'));
    });
    expect(meter()).not.toBeNull();
  });

  test('hidden when nothing is synced: sync declined, or unavailable', async () => {
    const { store } = await renderSync();
    expect(meter()).not.toBeNull();
    act(() => {
      store.dispatch(declineCloudConsent());
    });
    expect(meter()).toBeNull();
    act(() => {
      store.dispatch(grantCloudConsent());
      store.dispatch(setLoggedOut());
      store.dispatch(deviceIdReadFinished());
    });
    expect(meter()).toBeNull();
  });
});

// KAN-633. With sync off the bar stayed hidden at any size, so 1.2 MB of sessions learned it
// could not sync only after the yes. From 80% it now shows there too; below, the off pane is unchanged.
describe('the sync space bar with sync off (KAN-633)', () => {
  const renderOff = (bytes: number) =>
    renderWithProviders(<SettingsDetailsContainer />, {
      seedStore: (store) => {
        store.dispatch(replaceState(containerOf(bytes)));
        store.dispatch(selectCategory(SettingsCategory.SYNC));
        store.dispatch(setSignedIn());
        store.dispatch(setCloudConfigured(true));
        store.dispatch(declineCloudConsent());
      },
    });
  const state = () =>
    screen.getByTestId('sync-status').getAttribute('data-sync-state');

  test('under 80%: no bar', async () => {
    await renderOff(Math.floor(FIRESTORE_MAX_DOCUMENT_BYTES * 0.75));
    expect(state()).toBe('off');
    expect(meter()).toBeNull();
  });

  test('from 80%: the bar warns, red, with what to do', async () => {
    await renderOff(Math.ceil(FIRESTORE_MAX_DOCUMENT_BYTES * 0.85));
    expect(state()).toBe('off');
    expect(screen.getByTestId('sync-space').dataset.level).toBe('near');
    expect(line()).toMatch(
      / of the 1 MB sync limit\. Sync stops at 1 MB: delete sessions you no longer need\.$/
    );
  });

  test('past the limit: full, and it says the sessions are too large to sync', async () => {
    await renderOff(FIRESTORE_MAX_DOCUMENT_BYTES + 50_000);
    expect(state()).toBe('off');
    expect(screen.getByTestId('sync-space').dataset.level).toBe('full');
    expect(meter()?.getAttribute('aria-valuenow')).toBe('100');
    expect(line()).toMatch(
      /Too large to sync: delete sessions you no longer need\.$/
    );
  });

  test('appears as the sessions cross 80%, and goes when they drop back', async () => {
    const { store } = await renderOff(
      Math.floor(FIRESTORE_MAX_DOCUMENT_BYTES * 0.75)
    );
    expect(meter()).toBeNull();
    act(() => {
      store.dispatch(
        replaceState(containerOf(Math.ceil(FIRESTORE_MAX_DOCUMENT_BYTES * 0.9)))
      );
    });
    expect(screen.getByTestId('sync-space').dataset.level).toBe('near');
    act(() => {
      store.dispatch(
        replaceState(
          containerOf(Math.floor(FIRESTORE_MAX_DOCUMENT_BYTES * 0.5))
        )
      );
    });
    expect(meter()).toBeNull();
  });

  test('unavailable stays without a bar, even past the limit', async () => {
    const { store } = await renderOff(FIRESTORE_MAX_DOCUMENT_BYTES + 50_000);
    act(() => {
      store.dispatch(setLoggedOut());
      store.dispatch(deviceIdReadFinished());
    });
    expect(state()).toBe('unavailable');
    expect(meter()).toBeNull();
  });
});
