import { expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-303. Each saved window's chevron names its window and says whether it
// is open, as Open now's does (KAN-280).

const buildWindow = (n: number, title: string, tabTitle: string) => ({
  windowId: `win-${n}`,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 1,
  title,
  tabs: [
    {
      tabId: `w${n}-t0`,
      favicon: '',
      title: tabTitle,
      url: `https://example.com/w${n}`,
    },
  ],
});

const renderSession = (titles: [string, string]) =>
  renderWithProviders(<TabGroupDetailsContainer />, {
    seedStore: (s) => {
      s.dispatch(
        saveToTabContainerInternal({
          tabGroupId: 'group-1',
          title: 'Research',
          createdTime: '2026-09-01 09:01:00',
          createdAt: Date.UTC(2026, 8, 1, 9, 1, 0),
          windowCount: 2,
          tabCount: 2,
          isAutoSave: false,
          isSelected: false,
          windows: [
            buildWindow(1, titles[0], 'Alpha Page'),
            buildWindow(2, titles[1], 'Bravo Page'),
          ],
        })
      );
      s.dispatch(selectTabContainer('group-1'));
    },
  });

test("a saved window's chevron names its window and its state", async () => {
  await renderSession(['Morning reading', 'Evening reading']);

  const morning = await screen.findByRole('button', {
    name: 'Collapse: Morning reading',
    expanded: true,
  });
  expect(
    screen.getByRole('button', {
      name: 'Collapse: Evening reading',
      expanded: true,
    })
  ).toBeInTheDocument();

  await userEvent.click(morning);

  expect(screen.queryByText('Alpha Page')).toBeNull();
  expect(
    screen.getByRole('button', {
      name: 'Expand: Morning reading',
      expanded: false,
    })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', {
      name: 'Collapse: Evening reading',
      expanded: true,
    })
  ).toBeInTheDocument();
});

test('an untitled window keeps the bare verb, not "Collapse: "', async () => {
  await renderSession(['', 'Evening reading']);

  expect(
    await screen.findByRole('button', { name: 'Collapse', expanded: true })
  ).toBeInTheDocument();
});
