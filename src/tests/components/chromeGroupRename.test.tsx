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
  // The ROW opens the group now (KAN-121); the pencil is the only way to
  // rename. Both are still named so that a voice-control user can say either.
  test('the row is named for opening, the pencil for renaming', async () => {
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    expect(
      screen.getByRole('button', { name: 'Open group: Research' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Rename group' })
    ).toBeInTheDocument();
  });

  test('an untitled group is named by its placeholder in both', async () => {
    await renderWindow([{ groupId: 'g1', title: '', color: 'orange' }]);

    expect(
      screen.getByRole('button', { name: 'Open group: Unnamed group' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Rename group' })
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

    await user.click(screen.getByRole('button', { name: 'Rename group' }));
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

    await user.click(screen.getByRole('button', { name: 'Rename group' }));
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

    await user.click(screen.getByRole('button', { name: 'Rename group' }));
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

    await user.click(screen.getByRole('button', { name: 'Rename group' }));
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

    await user.click(screen.getByRole('button', { name: 'Rename group' }));

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

// The group editor had no visible way to finish either -- see the matching
// suite in HeroContainerRight.test.tsx. Enter and blur both commit, but a
// pointer user has nothing to aim at.
describe('finishing a group rename', () => {
  test('offers a confirm control while editing', async () => {
    const user = userEvent.setup();
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    await user.click(screen.getByRole('button', { name: 'Rename group' }));

    expect(
      screen.getByRole('button', { name: 'Save changes' })
    ).toBeInTheDocument();
  });

  // THE CONTROL: the tick belongs to the editing state, not to the row.
  test('CONTROL: no confirm control when not editing', async () => {
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    expect(
      screen.queryByRole('button', { name: 'Save changes' })
    ).not.toBeInTheDocument();
  });

  test('the confirm control commits the rename', async () => {
    const user = userEvent.setup();
    const { store } = await renderWindow([
      { groupId: 'g1', title: 'Research', color: 'blue' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Rename group' }));
    const input = screen.getByRole('textbox', {
      name: 'Rename group: Research',
    });
    await user.clear(input);
    await user.type(input, 'Reading');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(storedGroupTitle(store)).toBe('Reading');
  });

  // The rename actions must come back afterwards, or confirming would strand
  // the row without its controls.
  test('the row returns to its normal actions once confirmed', async () => {
    const user = userEvent.setup();
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    await user.click(screen.getByRole('button', { name: 'Rename group' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Rename group' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More actions' })
    ).toBeInTheDocument();
  });
});

// Pins preventDefault specifically. The wrapper alone is what stops the editor
// reopening -- measured by removing each in turn -- so the behavioural tests
// above pass with or without preventDefault. Its job is different: keeping
// focus in the input means onClick is the single commit path instead of racing
// a blur. Asserted at the mechanism, because that is the only place it shows.
describe('the confirm tick does not blur the field it commits', () => {
  test.each([['group', 'Rename group']])(
    '%s tick prevents the default mousedown',
    async (_label, opener) => {
      const user = userEvent.setup();
      await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

      await user.click(screen.getByRole('button', { name: opener }));
      const tick = screen.getByRole('button', { name: 'Save changes' });

      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });
      tick.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    }
  );
});

// The editor collapsed to the intrinsic height of its 0.8rem text -- 20px in a
// 22px row -- and carried the browser's default 2px padding rather than a
// chosen one. Beside the window title editor one level up, which fills its row
// exactly and pads to 8px, it read as a thinner, tighter box.
//
// Asserted as "fills its own row" rather than a pixel count: the group row is
// deliberately smaller than the window row, so matching absolute heights would
// be wrong. What has to match is the treatment.
describe('the group rename editor fills its row', () => {
  const openEditor = async () => {
    const user = userEvent.setup();
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);
    await user.click(screen.getByRole('button', { name: 'Rename group' }));
    return screen.getByRole('textbox', { name: 'Rename group: Research' });
  };

  // Asserts align-self, not height. A previous version of this test checked
  // `height: 100%` -- which was set, computed, and rendered NOTHING: the strip
  // is a flex container with only a min-height, so there is no definite height
  // for the percentage to resolve against. The declaration was present and the
  // field was still 2px short. jsdom does no layout, so it cannot catch that;
  // the rendered height is verified in a browser instead.
  test('stretches to its row rather than sizing to its text', async () => {
    const input = await openEditor();

    expect(getComputedStyle(input).alignSelf).toBe('stretch');
  });

  test('pads its text like the window editor does, not the browser default', async () => {
    const input = await openEditor();

    expect(getComputedStyle(input).paddingLeft).toBe('8px');
  });
});

// The group title shipped at 0.8rem -- the smallest content text in the pane,
// and smaller than the tabs the group contains, which inverts the hierarchy: a
// container reading as subordinate to its own children.
//
// 0.85rem rather than 0.9rem, chosen after comparing all three in a browser.
// 0.9rem is what the WINDOW title uses, so matching it would make a group as
// loud as the window that holds it, and a heavier 0.9 louder still.
//
// This narrows the inversion without removing it: tab titles are also 0.9rem,
// so no value is both smaller than the window and not smaller than the tabs.
// The real flatness is that window and tab share a size, leaving no step for a
// group to occupy. Deliberately not addressed here.
describe('the group title size', () => {
  test('is larger than the 0.8rem it shipped at', async () => {
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    // 0.85rem at the 16px root
    expect(getComputedStyle(screen.getByText('Research')).fontSize).toBe(
      '13.6px'
    );
  });

  // THE CONTROL. The point of the change is the gap to the tabs, so the tab
  // title must stay where it is -- shrinking the tabs would also "fix" the
  // ratio and would be the wrong fix entirely.
  test('CONTROL: the tab titles are unchanged at 0.9rem', async () => {
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    expect(getComputedStyle(screen.getByText('Inbox')).fontSize).toBe('14.4px');
  });

  // The editor replaces the label in place, so a different size there would
  // make the text visibly jump on entering and leaving edit mode.
  test('the editor matches the label it replaces', async () => {
    const user = userEvent.setup();
    await renderWindow([{ groupId: 'g1', title: 'Research', color: 'blue' }]);

    const labelSize = getComputedStyle(screen.getByText('Research')).fontSize;
    await user.click(screen.getByRole('button', { name: 'Rename group' }));
    const input = screen.getByRole('textbox', {
      name: 'Rename group: Research',
    });

    expect(getComputedStyle(input).fontSize).toBe(labelSize);
  });
});
