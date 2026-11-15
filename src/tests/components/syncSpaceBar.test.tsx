import { describe, expect, test } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';

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
import { FIRESTORE_MAX_DOCUMENT_BYTES } from '../../utils/functions/local';
import { syncBytes } from '../../utils/functions/cloudDocument';
import type { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';
import { incompressible } from '../fixtures/incompressible';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';
import { formatSyncUsed } from '../../utils/functions/syncSpace';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  BLUE_THEME,
  LIGHT_THEME,
  ThemeColorsOverride,
} from '../../hooks/useThemeColors';
import { rgb } from '../setup/hexColor';

// KAN-596. How much of the 1 MB the sync may write, under Sync Status.

// KAN-6. The bar reads the compressed size, so pad with text gzip cannot shrink.
const withUrlPad = (pad: string): TabMasterContainer => {
  const base = buildSession({ tabGroupId: 'big' });
  const tab = base.windows[0].tabs[0];
  return buildContainer([
    {
      ...base,
      windows: [
        {
          ...base.windows[0],
          tabs: [{ ...tab, url: `${tab.url}${pad}` }],
        },
      ],
    },
  ]);
};

// One session whose compressed document is about `bytes` (two passes, within a few hundred bytes).
const containerOf = async (bytes: number): Promise<TabMasterContainer> => {
  const base = await syncBytes(withUrlPad(''));
  let length = Math.max(0, Math.round((bytes - base) / 0.75));
  const first = await syncBytes(withUrlPad(incompressible(length)));
  length = Math.max(0, Math.round(length + (bytes - first) / 0.75));
  return withUrlPad(incompressible(length));
};

// Long enough for any measure in these tests to land (gzip of ~1 MB is a few ms).
const measured = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

const renderSync = async (bytes?: number, theme = LIGHT_THEME) => {
  const container = bytes === undefined ? undefined : await containerOf(bytes);
  const view = await renderWithProviders(
    <ThemeColorsOverride.Provider value={theme}>
      <SettingsDetailsContainer />
    </ThemeColorsOverride.Provider>,
    {
      seedStore: (store) => {
        if (container !== undefined) store.dispatch(replaceState(container));
        store.dispatch(selectCategory(SettingsCategory.SYNC));
        store.dispatch(setSignedIn());
        store.dispatch(setCloudConfigured(true));
        store.dispatch(grantCloudConsent());
      },
    }
  );
  await measured();
  return view;
};

// KAN-625. Named for what it measures: the sessions here against the sync limit, not cloud storage.
const meter = () => screen.queryByRole('meter', { name: 'Sync limit used' });
const fill = () => meter()?.firstElementChild as HTMLElement | null;
const fillColor = () => getComputedStyle(fill() as HTMLElement).backgroundColor;
const line = () => screen.getByTestId('sync-space').textContent;

describe('the sync space bar (KAN-596)', () => {
  test('reads the compressed size, and follows the sessions', async () => {
    const { store } = await renderSync();
    const used = () => syncBytes(store.getState().tabContainerDataState);
    expect(line()).toBe(
      `Your sessions use ${formatSyncUsed(await used(), 'en')} of the 1 MB sync limit.`
    );
    expect(meter()?.getAttribute('aria-valuenow')).toBe(
      String(Math.round(((await used()) / FIRESTORE_MAX_DOCUMENT_BYTES) * 100))
    );

    const before = await used();
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
    const after = await used();
    expect(after).toBeGreaterThan(before);
    await waitFor(() =>
      expect(line()).toBe(
        `Your sessions use ${formatSyncUsed(after, 'en')} of the 1 MB sync limit.`
      )
    );
  });

  // KAN-6. Over 80% as plain JSON, a fraction of it compressed: not red.
  test('a big plain account that compresses well reads its compressed size', async () => {
    const big = withUrlPad(
      'a'.repeat(Math.ceil(FIRESTORE_MAX_DOCUMENT_BYTES * 0.85))
    );
    const view = await renderSync();
    act(() => {
      view.store.dispatch(replaceState(big));
    });
    await measured();
    expect(screen.getByTestId('sync-space').dataset.level).toBe('ok');
    expect(line()).toBe(
      `Your sessions use ${formatSyncUsed(await syncBytes(big), 'en')} of the 1 MB sync limit.`
    );
  });

  // KAN-6. A slow measure of an older container must not land over a newer one.
  test('a stale measure never shows', async () => {
    const view = await renderSync();
    const slow = await containerOf(FIRESTORE_MAX_DOCUMENT_BYTES * 2);
    // A few kB, so the line shows its own number rather than "under 1 kB".
    const small = buildContainer([
      buildSession({ tabGroupId: 'small', title: incompressible(2000) }),
    ]);
    // Two renders, so the slow measure is already running when the small one starts.
    act(() => {
      view.store.dispatch(replaceState(slow));
    });
    act(() => {
      view.store.dispatch(replaceState(small));
    });
    await measured();
    expect(screen.getByTestId('sync-space').dataset.level).toBe('ok');
    expect(line()).toBe(
      `Your sessions use ${formatSyncUsed(await syncBytes(small), 'en')} of the 1 MB sync limit.`
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
    const used = await syncBytes(store.getState().tabContainerDataState);
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
    await measured();
    // PREMISE: an empty list still writes its frame, so the bytes are not 0.
    expect(
      await syncBytes(store.getState().tabContainerDataState)
    ).toBeGreaterThan(0);
    expect(line()).toBe('Your sessions use 0 kB of the 1 MB sync limit.');
    expect(fill()?.style.minWidth).toBe('');
  });

  // KAN-6. Compressed, a couple of short sessions come to under 1 kB: never "0 kB" while sessions are saved.
  test('saved sessions under 1 kB read "under 1 kB" and draw the sliver', async () => {
    const { store } = await renderSync();
    act(() => {
      store.dispatch(
        replaceState(
          buildContainer([
            buildSession({ tabGroupId: 'a', title: 'Reading list' }),
            buildSession({ tabGroupId: 'b', title: 'Trip planning' }),
          ])
        )
      );
    });
    await measured();
    // PREMISE: rounds to 0 kB, the case the line used to show as "0 kB".
    expect(
      await syncBytes(store.getState().tabContainerDataState)
    ).toBeLessThan(512);
    expect(line()).toBe('Your sessions use under 1 kB of the 1 MB sync limit.');
    expect(fill()?.style.minWidth).toBe('3px');
  });

  // The example session never syncs (KAN-600), so it alone is no sessions.
  test('only the example session reads 0 kB, no sliver', async () => {
    const { store } = await renderSync();
    act(() => {
      store.dispatch(
        replaceState(
          buildContainer([buildSession({ tabGroupId: `${SAMPLE_ID_PREFIX}x` })])
        )
      );
    });
    await measured();
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
    // KAN-6. The bar remounts and measures again; check once that has landed.
    await measured();
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
  const renderOff = async (bytes: number) => {
    const container = await containerOf(bytes);
    const view = await renderWithProviders(<SettingsDetailsContainer />, {
      seedStore: (store) => {
        store.dispatch(replaceState(container));
        store.dispatch(selectCategory(SettingsCategory.SYNC));
        store.dispatch(setSignedIn());
        store.dispatch(setCloudConfigured(true));
        store.dispatch(declineCloudConsent());
      },
    });
    await measured();
    return view;
  };
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
    const near = await containerOf(
      Math.ceil(FIRESTORE_MAX_DOCUMENT_BYTES * 0.9)
    );
    const half = await containerOf(
      Math.floor(FIRESTORE_MAX_DOCUMENT_BYTES * 0.5)
    );
    act(() => {
      store.dispatch(replaceState(near));
    });
    await measured();
    expect(screen.getByTestId('sync-space').dataset.level).toBe('near');
    act(() => {
      store.dispatch(replaceState(half));
    });
    await measured();
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
