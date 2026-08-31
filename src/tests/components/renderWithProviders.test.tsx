import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import { renderWithProviders } from '../setup/renderWithProviders';

function Probe() {
  const { t } = useTranslation();
  return <div>{t('Open session')}</div>;
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
    const { store, chrome } = await renderWithProviders(<Probe />, {
      seed: { tabs: [{ id: 1, title: 'Seeded', active: true }] },
    });

    expect(Object.keys(store.getState())).toContain('tabContainerDataState');
    expect(chrome.createdTabs).toEqual([]);
  });
});
