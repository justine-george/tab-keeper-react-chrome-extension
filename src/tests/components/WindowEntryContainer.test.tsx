import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type {
  chromeTabGroupData,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';

async function renderWindow(props: {
  tabs: tabData[];
  chromeTabGroups?: chromeTabGroupData[];
}) {
  return renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      onWindowTitleClick={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
      {...props}
    />
  );
}

describe('WindowEntryContainer renders Chrome tab groups', () => {
  test('renders a band and title for each group, and ungrouped tabs outside them', async () => {
    await renderWindow({
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'Inbox',
          url: 'https://a.test',
          chromeGroupId: 'g1',
        },
        {
          tabId: 't2',
          favicon: '',
          title: 'Docs',
          url: 'https://b.test',
          chromeGroupId: 'g1',
        },
        { tabId: 't3', favicon: '', title: 'Loose', url: 'https://c.test' },
      ],
      chromeTabGroups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
    });

    const group = screen.getByRole('group', { name: 'Work' });
    expect(within(group).getByText('Inbox')).toBeInTheDocument();
    expect(within(group).getByText('Docs')).toBeInTheDocument();
    expect(within(group).queryByText('Loose')).not.toBeInTheDocument();
    expect(screen.getByText('Loose')).toBeInTheDocument();
  });

  test('an untitled group is named for screen readers but shows no label', async () => {
    await renderWindow({
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'Inbox',
          url: 'https://a.test',
          chromeGroupId: 'g1',
        },
      ],
      chromeTabGroups: [{ groupId: 'g1', title: '', color: 'red' }],
    });

    // Chrome shows an unnamed group as a bare colour, so the pane does too --
    // the string exists only as the accessible name.
    expect(
      screen.getByRole('group', { name: 'Unnamed group' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Unnamed group')).not.toBeInTheDocument();
  });

  test('a window with no groups renders exactly as it did before', async () => {
    await renderWindow({
      tabs: [
        { tabId: 't1', favicon: '', title: 'Inbox', url: 'https://a.test' },
      ],
    });

    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });
});
