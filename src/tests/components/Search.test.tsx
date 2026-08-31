import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  openSearchPanel,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';

const session = (title: string, tabTitle: string) => ({
  tabGroupId: `id-${title}`,
  title,
  createdTime: '2026-08-31 09:00:00',
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `win-${title}`,
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'A window',
      tabs: [
        {
          tabId: `tab-${title}`,
          favicon: '',
          title: tabTitle,
          url: 'https://example.com/',
        },
      ],
    },
  ],
});

describe('search filtering', () => {
  test('narrows the rendered sessions to those that match', async () => {
    const { store } = await renderWithProviders(<TabGroupEntryContainer />);

    store.dispatch(
      saveToTabContainerInternal(session('Research', 'Kagi Search'))
    );
    store.dispatch(
      saveToTabContainerInternal(session('Errands', 'Grocery list'))
    );
    store.dispatch(openSearchPanel());

    expect(await screen.findByText('Research')).toBeTruthy();
    expect(screen.getByText('Errands')).toBeTruthy();

    store.dispatch(setSearchInputText('kagi'));

    expect(await screen.findByText('Research')).toBeTruthy();
    expect(screen.queryByText('Errands')).toBeNull();
  });

  test('is case-insensitive', async () => {
    const { store } = await renderWithProviders(<TabGroupEntryContainer />);

    store.dispatch(
      saveToTabContainerInternal(session('Research', 'Kagi Search'))
    );
    store.dispatch(openSearchPanel());
    store.dispatch(setSearchInputText('KAGI'));

    expect(await screen.findByText('Research')).toBeTruthy();
  });
});
