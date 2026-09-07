import { describe, expect, test } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

  test('an untitled group shows a visible placeholder and keeps its name', async () => {
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

    // This test used to assert the OPPOSITE -- that "Unnamed group" existed
    // only as the accessible name, because Chrome shows an unnamed group as a
    // bare colour and the pane matched it.
    //
    // That held while the title was inert text. Making a group renameable
    // needs a control, and the only place for one is a header strip that did
    // not exist before. Reserving the strip and leaving it blank costs the
    // same vertical space as filling it while explaining nothing, so the
    // placeholder is now shown. It is italic and one label tier dimmer than a
    // real name, so it reads as "this group has no name" rather than as a
    // group actually called that. Decision recorded in
    // chromeGroupRename.test.tsx.
    expect(
      screen.getByRole('group', { name: 'Unnamed group' })
    ).toBeInTheDocument();
    expect(screen.getByText('Unnamed group')).toBeInTheDocument();
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
    // The band used to be the sole aria-hidden child -- decorative, carrying no
    // name of its own (BINDING CONSTRAINT 3). KAN-124 made it the colour
    // control, so it is now a NAMED button and is found that way. Decorative
    // was right while it only painted; a control has to be named.
    const band = within(group).getByRole('button', {
      name: 'Change group color: Work',
    });
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

  // The test above seeds a VALID colour, so it passes equally whether the
  // component sanitizes run.group.color or uses it raw -- it cannot tell the
  // two apart. An invalid colour can: only the sanitized path degrades it to
  // grey, so this is the case that actually pins sanitizeTabGroupColor being
  // called rather than assumed.
  test('an unrecognised colour is sanitized to grey rather than rendered raw', async () => {
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
      chromeTabGroups: [{ groupId: 'g1', title: 'Work', color: 'chartreuse' }],
    });

    const group = screen.getByRole('group', { name: 'Work' });
    const band = within(group).getByRole('button', {
      name: 'Change group color: Work',
    });
    expect(band).not.toBeNull();
    const [r, g, b] = hexToRgb(TAB_GROUP_COLOR_HEX.grey);
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

// The window rename's tick predates the session and group ones. It works in
// real Chrome -- verified by driving the built artifact -- but jsdom retargets
// the post-blur click differently, so without preventDefault on mousedown the
// commit closes the editor and the click then reopens it via the pencil that
// took the tick's place. Pinned here so all three ticks behave identically and
// none of them depends on that environment difference.
describe('finishing a window rename', () => {
  test('the tick commits and leaves the editor closed', async () => {
    const user = userEvent.setup();
    const { store } = await renderWindow({
      tabs: [
        { tabId: 't1', favicon: '', title: 'Inbox', url: 'https://a.test' },
      ],
    });

    await user.click(
      screen.getByRole('button', { name: 'Rename window group' })
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Rename window group' })
    ).toBeInTheDocument();
    expect(store).toBeDefined();
  });
});

// Two faults in the window title editor, both visible once the group editor
// beside it was made right.
//
// The tick lives inside the row's action block, whose opacity is driven by
// isParentHovered. While editing, focus is in the INPUT -- outside that block
// -- so neither the hover flag nor :focus-within applies and the tick was
// invisible unless the pointer happened to be over the row. The group editor
// does not have this problem because its reveal is keyed off the strip that
// CONTAINS the input.
//
// And parentLinkStyle reserves padding-right: 9px to keep the resting title
// clear of the action icons. While editing there is no title to keep clear,
// so the field stopped 9px short of the row's edge -- measured in a browser.
describe('the window title editor', () => {
  const openEditor = async () => {
    const user = userEvent.setup();
    await renderWindow({
      tabs: [
        { tabId: 't1', favicon: '', title: 'Inbox', url: 'https://a.test' },
      ],
    });
    await user.click(
      screen.getByRole('button', { name: 'Rename window group' })
    );
    return screen.getByRole('textbox');
  };

  // Asserted against the generated CSS, not getComputedStyle. The reveal is a
  // `& > *` rule, and jsdom does not resolve child combinators for computed
  // style -- it reports opacity 1 for the tick whatever the state, which is how
  // three earlier versions of this test passed against the bug. The browser
  // reports 0. Verified there too.
  test('shows its confirm tick without needing the pointer', async () => {
    await openEditor();

    // Load-bearing. userEvent.click moves the virtual pointer onto the row, so
    // onMouseEnter fires and isParentHovered stays TRUE -- which made two
    // earlier versions of this test pass by exercising the hover path and
    // never touching isEditing at all. mouseLeave is fired directly rather
    // than via unhover(), because the element the pointer was last over has
    // since unmounted.
    let row: HTMLElement | null = screen.getByRole('textbox');
    while (row && getComputedStyle(row).position !== 'relative') {
      row = row.parentElement;
    }
    fireEvent.mouseLeave(row as HTMLElement);

    const tick = screen.getByRole('button', { name: 'Save changes' });

    let block: HTMLElement | null = tick;
    while (block && getComputedStyle(block).position !== 'absolute') {
      block = block.parentElement;
    }
    const classes = [...(block as HTMLElement).classList].map((c) => `.${c}`);

    const childRules: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of [...rules]) {
        const text = rule.cssText;
        if (
          classes.some((c) => text.includes(`${c}>`) || text.includes(`${c} >`))
        )
          childRules.push(text);
      }
    }

    expect(childRules.join('\n')).toMatch(/opacity:\s*1/);
  });

  test('runs the field to the edge of its row', async () => {
    const input = await openEditor();

    expect(
      getComputedStyle(input.parentElement as HTMLElement).paddingRight
    ).toBe('0px');
  });

  // THE CONTROL for the padding. The 9px exists for a reason -- it keeps the
  // resting title clear of the action icons -- so it must survive when the row
  // is NOT being edited.
  test('CONTROL: the resting title still reserves room for the actions', async () => {
    await renderWindow({
      tabs: [
        { tabId: 't1', favicon: '', title: 'Inbox', url: 'https://a.test' },
      ],
    });

    const title = screen.getByRole('button', { name: 'Window 1' });

    expect(getComputedStyle(title).paddingRight).toBe('9px');
  });
});
