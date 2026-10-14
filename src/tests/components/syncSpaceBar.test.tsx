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

const renderSync = (bytes?: number) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      if (bytes !== undefined) store.dispatch(replaceState(containerOf(bytes)));
      store.dispatch(selectCategory(SettingsCategory.SYNC));
      store.dispatch(setSignedIn());
      store.dispatch(setCloudConfigured(true));
      store.dispatch(grantCloudConsent());
    },
  });

const meter = () => screen.queryByRole('meter', { name: 'Sync space used' });
const line = () => screen.getByTestId('sync-space').textContent;

describe('the sync space bar (KAN-596)', () => {
  test('reads exactly what the sync measures before it writes, and follows the sessions', async () => {
    const { store } = await renderSync();
    const used = () =>
      estimateFirestoreBytes(store.getState().tabContainerDataState);
    expect(line()).toBe(
      `${formatSyncUsed(used(), 'en')} of 1 MB sync space used`
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
      `${formatSyncUsed(used(), 'en')} of 1 MB sync space used`
    );
  });

  test('from 80% it warns; past the limit it says the sessions are too large to sync', async () => {
    await renderSync(Math.ceil(FIRESTORE_MAX_DOCUMENT_BYTES * 0.85));
    expect(screen.getByTestId('sync-space').dataset.level).toBe('near');
    expect(line()).toMatch(
      / of 1 MB sync space used\. Sync stops at 1 MB: delete sessions you no longer need\.$/
    );
  });

  test('past the limit the fill stops at full', async () => {
    await renderSync(FIRESTORE_MAX_DOCUMENT_BYTES + 50_000);
    expect(screen.getByTestId('sync-space').dataset.level).toBe('full');
    expect(line()).toMatch(
      /^1\.\d MB of 1 MB sync space used\. Too large to sync: delete sessions you no longer need\.$/
    );
    expect(meter()?.getAttribute('aria-valuenow')).toBe('100');
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
    });
    expect(meter()).toBeNull();
  });
});
