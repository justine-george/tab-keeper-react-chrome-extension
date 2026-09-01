import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { renderWithProviders } from '../setup/renderWithProviders';
import { RootState } from '../../redux/store';
import { setUserId } from '../../redux/slices/globalStateSlice';

function Probe() {
  const { t } = useTranslation();
  return <div>{t('Open session')}</div>;
}

// Reads from the store via useSelector, so it throws (rather than silently
// rendering) if the Provider is missing from the tree -- exactly what
// rerender must not let happen. userId is present on the initial store from
// makeTestStore() with no seeding required.
function StoreProbe() {
  const userId = useSelector((state: RootState) => state.globalState.userId);
  return <div>userId: {String(userId)}</div>;
}

describe('renderWithProviders', () => {
  // 'Open session' is one of the 19 en keys whose value differs from the key.
  // Asserting on the VALUE is what proves i18n is really running rather than
  // an identity mock -- under `t: (k) => k` this test fails.
  test('renders real translated text, not the key', async () => {
    await renderWithProviders(<Probe />);

    expect(
      screen.getByText('Open session, keeping current windows')
    ).toBeTruthy();
    expect(screen.queryByText('Open session')).toBeNull();
  });

  test('exposes a working store and the chrome fake', async () => {
    const { store } = await renderWithProviders(<Probe />, {
      seed: { tabs: [{ id: 1, title: 'Seeded', active: true }] },
    });

    expect(Object.keys(store.getState())).toContain('tabContainerDataState');

    // Query the global chrome the wrapper installed, rather than asserting
    // on the freshly-constructed handle (which starts empty regardless of
    // whether setupChromeFake ever ran). This actually observes that the
    // seed took effect: it fails if setupChromeFake(seed) is removed from
    // renderWithProviders, because global.chrome would then be undefined.
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({}, resolve)
    );
    expect(tabs.map((tab) => tab.title)).toContain('Seeded');
  });

  test('rerender keeps the Provider in the tree', async () => {
    const { rerender, store } = await renderWithProviders(<StoreProbe />);

    // Sanity check: the store starts with no user signed in.
    expect(screen.getByText('userId: null')).toBeTruthy();

    store.dispatch(setUserId('user-123'));
    rerender(<StoreProbe />);

    // If the Provider dropped out of the tree on rerender, useSelector
    // throws during this render rather than returning a stale value, so
    // this assertion (rather than a crash) is what proves the fix.
    expect(screen.getByText('userId: user-123')).toBeTruthy();
  });
});
