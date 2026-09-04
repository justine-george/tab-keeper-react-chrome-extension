import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { TAB_GROUP_COLOR_HEX } from '../../utils/functions/tabGroups';
import type {
  chromeTabGroupData,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';

// Defaults to the GRANTED permission so the three pre-existing rendering
// tests below stay exactly as they were before the permission gate (KAN-11
// fix round 1) -- they never had to learn about the flag because "the
// permission is on" is the baseline every one of them was written against.
// Callers that care about the ungranted path pass hasTabGroupsPermission
// explicitly.
async function renderWindow(
  props: {
    tabs: tabData[];
    chromeTabGroups?: chromeTabGroupData[];
  },
  { hasTabGroupsPermission = true }: { hasTabGroupsPermission?: boolean } = {}
) {
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
    />,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(hasTabGroupsPermission));
      },
    }
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

  test('paints the group band with the group color', async () => {
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
      chromeTabGroups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
    });

    const group = screen.getByRole('group', { name: 'Work' });
    // The band is the sole aria-hidden child of the group -- a decorative
    // element carrying no accessible name of its own (BINDING CONSTRAINT 3).
    const band = group.querySelector('[aria-hidden="true"]');
    expect(band).not.toBeNull();
    // TAB_GROUP_COLOR_HEX.blue is '#8ab4f8'; jsdom's getComputedStyle
    // resolves emotion's inserted class rules and reports colors as rgb(),
    // so the hex is asserted via its own known conversion rather than a
    // second hardcoded literal.
    const [r, g, b] = hexToRgb(TAB_GROUP_COLOR_HEX.blue);
    expect(getComputedStyle(band as Element).backgroundColor).toBe(
      `rgb(${r}, ${g}, ${b})`
    );
  });
});

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

describe('WindowEntryContainer gates tab groups on the live permission', () => {
  test('renders no groups when the permission is not granted, even with saved group data', async () => {
    await renderWindow(
      {
        tabs: [
          {
            tabId: 't1',
            favicon: '',
            title: 'Inbox',
            url: 'https://a.test',
            chromeGroupId: 'g1',
          },
        ],
        chromeTabGroups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
      },
      { hasTabGroupsPermission: false }
    );

    // Data present, permission absent: nothing about the grouping draws --
    // no role="group" boundary and no group title -- because applyTabGroups
    // silently no-ops on restore without the live permission, and showing a
    // band we cannot honour would be a broken promise (KAN-11 fix round 1).
    // The tab itself is unaffected: it still renders, just ungrouped.
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });

  test('renders groups when the permission is granted, with the same data', async () => {
    await renderWindow(
      {
        tabs: [
          {
            tabId: 't1',
            favicon: '',
            title: 'Inbox',
            url: 'https://a.test',
            chromeGroupId: 'g1',
          },
        ],
        chromeTabGroups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
      },
      { hasTabGroupsPermission: true }
    );

    const group = screen.getByRole('group', { name: 'Work' });
    expect(within(group).getByText('Inbox')).toBeInTheDocument();
  });
});
