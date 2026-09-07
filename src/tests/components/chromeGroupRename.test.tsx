import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  setHasTabGroupsPermission,
  openSearchPanel,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import type { chromeTabGroupData } from '../../redux/slices/tabContainerDataStateSlice';

// Renaming a Chrome tab group from the right pane.
//
// The session and window renames both wrap their title in a ClickableRow and
// reveal an edit Icon on hover/focus. A Chrome group could not simply copy
// that, because an UNTITLED group had no label node to wrap -- it rendered as
// the colour band alone. Measuring the mockup settled it: a rename control
// needs a header strip that does not exist today, so the strip is added for
// every group and an untitled one fills it with a placeholder rather than
// leaving 22px of unexplained blank space.
//
// That deliberately overturns the older decision that an untitled group shows
// no label at all. See the rewritten test in WindowEntryContainer.test.tsx.
//
// WindowEntryContainer is presentational: it takes chromeTabGroups as a PROP
// and dispatches the rename, but does not read the result back. So the tests
// here assert the STORE WRITE, which is this component's whole contract. That
// the new name then reaches the screen is TabGroupDetailsContainer's contract
// -- it selects the session from the store and passes the groups down -- and
// is asserted there instead.

const GROUPED_TABS = [
  {
    tabId: 't1',
    favicon: '',
    title: 'Inbox',
    url: 'https://a.test',
    chromeGroupId: 'g1',
  },
];

async function renderWindow(
  chromeTabGroups: chromeTabGroupData[],
  { isSearchPanel = false }: { isSearchPanel?: boolean } = {}
) {
  return renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      tabs={GROUPED_TABS}
      chromeTabGroups={chromeTabGroups}
      onWindowTitleClick={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        if (isSearchPanel) store.dispatch(openSearchPanel());
        // The component dispatches the rename itself, so the store must hold
        // a session whose ids match the props for the write to land.
        store.dispatch(
          saveToTabContainerInternal({
            tabGroupId: 'tg1',
            title: 'Session',
            createdTime: '2026-09-06 09:00:00',
            windowCount: 1,
            tabCount: 1,
            isAutoSave: false,
            isSelected: false,
            windows: [
              {
                windowId: 'w1',
                windowHeight: 1080,
                windowWidth: 1920,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 1,
                title: 'Window 1',
                tabs: GROUPED_TABS,
                chromeTabGroups,
              },
            ],
          })
        );
      },
    }
  );
}

const storedGroupTitle = (store: {
  getState: () => {
    tabContainerDataState: {
      tabGroups: { windows: { chromeTabGroups?: chromeTabGroupData[] }[] }[];
    };
  };
}) =>
  store.getState().tabContainerDataState.tabGroups[0].windows[0]
    .chromeTabGroups![0].title;

describe('an untitled Chrome group is nameable', () => {
  test('shows a visible placeholder instead of a bare colour band', async () => {
    await renderWindow([{ groupId: 'g1', title: '', color: 'orange' }]);

    expect(screen.getByText('Unnamed group')).toBeInTheDocument();
  });

  // The placeholder must not read as content. Italic + the dimmest label tier
  // is the grammar that says "this group has no name", so a user does not
  // believe the group is literally called "Unnamed group".
  test('renders the placeholder in italic', async () => {
    await renderWindow([{ groupId: 'g1', title: '', color: 'orange' }]);

    expect(getComputedStyle(screen.getByText('Unnamed group')).fontStyle).toBe(
      'italic'
    );
  });

  // THE CONTROL for the test above: a real name must NOT be italicised, or
  // the assertion would pass against a component that italicises everything.
  test('CONTROL: a real group name is not italic', async () => {
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    expect(getComputedStyle(screen.getByText('Research')).fontStyle).not.toBe(
      'italic'
    );
  });
});

describe('the rename control', () => {
  // WCAG 2.5.3, the same shape KAN-77 established for the session rename: the
  // accessible name has to CONTAIN the visible one, or a voice-control user
  // saying "click Research" has nothing to hit.
  test('is named for the group it renames', async () => {
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    expect(
      screen.getByRole('button', { name: 'Rename group: Research' })
    ).toBeInTheDocument();
  });

  test('names an untitled group by its placeholder', async () => {
    await renderWindow([{ groupId: 'g1', title: '', color: 'orange' }]);

    expect(
      screen.getByRole('button', { name: 'Rename group: Unnamed group' })
    ).toBeInTheDocument();
  });

  test('the group keeps its own accessible name', async () => {
    await renderWindow([{ groupId: 'g1', title: '', color: 'orange' }]);

    expect(
      screen.getByRole('group', { name: 'Unnamed group' })
    ).toBeInTheDocument();
  });

  // KAN-68: the hover reveal must have a keyboard equivalent, so the icon is
  // a real tab stop rather than something only a pointer can reach.
  test('the edit icon is reachable by keyboard', async () => {
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    const icon = screen.getByRole('button', { name: 'Rename group' });
    icon.focus();
    expect(icon).toHaveFocus();
  });
});

describe('committing a rename', () => {
  test('Enter writes the new name to the store', async () => {
    const user = userEvent.setup();
    const { store } = await renderWindow([
      { groupId: 'g1', title: 'Research', color: 'blue' },
    ]);

    await user.click(
      screen.getByRole('button', { name: 'Rename group: Research' })
    );
    const input = screen.getByRole('textbox', {
      name: 'Rename group: Research',
    });
    await user.clear(input);
    await user.type(input, 'Reading{Enter}');

    expect(storedGroupTitle(store)).toBe('Reading');
  });

  test('naming an untitled group writes the name to the store', async () => {
    const user = userEvent.setup();
    const { store } = await renderWindow([
      { groupId: 'g1', title: '', color: 'orange' },
    ]);

    await user.click(
      screen.getByRole('button', { name: 'Rename group: Unnamed group' })
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Rename group: Unnamed group' }),
      'Research{Enter}'
    );

    expect(storedGroupTitle(store)).toBe('Research');
  });

  test('clearing the field writes an empty name', async () => {
    const user = userEvent.setup();
    const { store } = await renderWindow([
      { groupId: 'g1', title: 'Research', color: 'blue' },
    ]);

    await user.click(
      screen.getByRole('button', { name: 'Rename group: Research' })
    );
    const input = screen.getByRole('textbox', {
      name: 'Rename group: Research',
    });
    await user.clear(input);
    await user.type(input, '{Enter}');

    expect(storedGroupTitle(store)).toBe('');
  });

  test('blurring commits, without needing Enter', async () => {
    const user = userEvent.setup();
    const { store } = await renderWindow([
      { groupId: 'g1', title: 'Research', color: 'blue' },
    ]);

    await user.click(
      screen.getByRole('button', { name: 'Rename group: Research' })
    );
    const input = screen.getByRole('textbox', {
      name: 'Rename group: Research',
    });
    await user.clear(input);
    await user.type(input, 'Reading');
    await user.tab();

    expect(storedGroupTitle(store)).toBe('Reading');
  });

  test('the draft is seeded with the current name, not left blank', async () => {
    const user = userEvent.setup();
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    await user.click(
      screen.getByRole('button', { name: 'Rename group: Research' })
    );

    expect(
      screen.getByRole('textbox', { name: 'Rename group: Research' })
    ).toHaveValue('Research');
  });
});

describe('the search panel', () => {
  // The same rule the window title follows: a control that cannot act must
  // not be focusable and inert (KAN-62). Renaming is disabled while searching.
  test('offers no rename control', async () => {
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }], {
      isSearchPanel: true,
    });

    expect(
      screen.queryByRole('button', { name: /Rename group/ })
    ).not.toBeInTheDocument();
    // The group itself still renders -- only the affordance is withheld.
    expect(
      within(screen.getByRole('group', { name: 'Research' })).getByText(
        'Research'
      )
    ).toBeInTheDocument();
  });
});
