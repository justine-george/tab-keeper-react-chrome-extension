import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { SAVE_TAB_CONTAINER_ACTION } from '../../utils/constants/actionTypes';

const seed = {
  tabs: [
    { id: 1, title: 'Kagi Search', url: 'https://kagi.com/', active: true },
  ],
  windows: [
    {
      id: 7,
      tabs: [
        { id: 1, title: 'Kagi Search', url: 'https://kagi.com/' },
      ] as chrome.tabs.Tab[],
    },
  ],
};

describe('UserInputContainer', () => {
  test('pre-fills the session name from the active tab', async () => {
    await renderWithProviders(<UserInputContainer />, { seed });

    expect(await screen.findByDisplayValue('Kagi Search')).toBeTruthy();
  });

  test('saving dispatches a session built from the open windows', async () => {
    const { store, seen } = await renderWithProviders(<UserInputContainer />, {
      seed,
    });

    await screen.findByDisplayValue('Kagi Search');
    await userEvent.click(screen.getByLabelText('save session'));

    expect(seen).toContain(SAVE_TAB_CONTAINER_ACTION);
    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups).toHaveLength(1);
    expect(tabGroups[0].title).toBe('Kagi Search');
    expect(tabGroups[0].windows[0].tabs[0].url).toBe('https://kagi.com/');
  });
});
