import { afterEach, describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-279 D7. The tab view hides the row's Switch (e2e tab-view checks the
// hidden controls in both pages); the row's own Open has to stay.

const noop = () => undefined;

const buildSession = (): tabContainerData => ({
  tabGroupId: 'group-1',
  title: 'Research',
  createdTime: '2026-08-31 09:00:00',
  createdAt: Date.UTC(2026, 7, 31, 9, 0, 0),
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: true,
  windows: [
    {
      windowId: 'win-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Morning reading',
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'Kagi Search',
          url: 'https://kagi.com/',
        },
      ],
    },
  ],
});

const renderTabGroupEntryRow = () =>
  renderWithProviders(
    <TabGroupEntry
      tabGroupData={buildSession()}
      onTabGroupClick={noop}
      onOpenAllClick={noop}
      onFocusClick={noop}
      onDeleteClick={noop}
    />
  );

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('the session row (D7)', () => {
  test('Open stays on the row in the tab view', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderTabGroupEntryRow();

    expect(
      await screen.findByRole('button', { name: 'Open' })
    ).toBeInTheDocument();
  });
});
