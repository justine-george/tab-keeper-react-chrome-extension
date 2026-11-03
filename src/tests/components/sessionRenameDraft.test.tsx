import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-917. While a session is renamed in the header, its row in the list shows
// what saving would leave; saving itself still happens once, on commit.

const group = (tabGroupId: string, title: string) => ({
  tabGroupId,
  title,
  createdTime: '2026-09-01 09:01:00',
  createdAt: Date.UTC(2026, 8, 1, 9, 1, 0),
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `${tabGroupId}-w`,
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Window 1',
      tabs: [
        {
          tabId: `${tabGroupId}-t`,
          favicon: '',
          title: 'Kagi',
          url: `https://example.com/${tabGroupId}`,
        },
      ],
    },
  ],
});

const RENAME = 'updateTabGroupTitle';

async function renaming() {
  const rendered = await renderWithProviders(<MainContainer />, {
    seedStore: (s) => {
      s.dispatch(saveToTabContainerInternal(group('g2', 'Groceries')));
      s.dispatch(saveToTabContainerInternal(group('g1', 'Live notes')));
      s.dispatch(selectTabContainer('g1'));
    },
  });
  await userEvent.click(await screen.findByLabelText('Rename session'));
  const input = screen.getByDisplayValue('Live notes');
  return { ...rendered, input };
}

// The list row's title: the row's button is named by it.
const row = (title: string) => screen.queryByRole('button', { name: title });
const renames = (seen: string[]) =>
  seen.filter((type) => type.endsWith(RENAME)).length;

describe('a session being renamed (KAN-917)', () => {
  test('its row shows the name as typed', async () => {
    const { input } = await renaming();
    await userEvent.type(input, ' for Friday');
    expect(row('Live notes for Friday')).not.toBeNull();
    expect(row('Live notes')).toBeNull();
  });

  test('typing saves nothing: one save, on Enter', async () => {
    const { input, seen, store } = await renaming();
    const before = renames(seen);
    await userEvent.type(input, ' for Friday');
    expect(renames(seen)).toBe(before);
    await userEvent.type(input, '{Enter}');
    expect(renames(seen)).toBe(before + 1);
    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'g1')
        ?.title
    ).toBe('Live notes for Friday');
    expect(row('Live notes for Friday')).not.toBeNull();
  });

  test('Esc puts the row back to the saved name', async () => {
    const { input } = await renaming();
    await userEvent.type(input, ' for Friday');
    await userEvent.type(input, '{Escape}');
    expect(row('Live notes')).not.toBeNull();
    expect(row('Live notes for Friday')).toBeNull();
  });

  test('a cleared field leaves the row on the saved name, as Enter would', async () => {
    const { input } = await renaming();
    await userEvent.clear(input);
    expect(row('Live notes')).not.toBeNull();
    await userEvent.type(input, '   ');
    expect(row('Live notes')).not.toBeNull();
  });

  test('the row shows the name trimmed, as it would be saved', async () => {
    const { input } = await renaming();
    await userEvent.clear(input);
    await userEvent.type(input, '  Friday  ');
    expect(row('Friday')).not.toBeNull();
  });

  test('other sessions keep their names', async () => {
    const { input } = await renaming();
    await userEvent.clear(input);
    await userEvent.type(input, 'Friday');
    expect(row('Groceries')).not.toBeNull();
  });
});
