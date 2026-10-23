import { describe, expect, test, vi } from 'vitest';
import { act, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  setHasTabGroupsPermission,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { classRulesFor } from '../setup/hoverRules';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { TAB_GROUP_COLOR_HEX } from '../../utils/functions/tabGroups';
import {
  replaceState,
  type chromeTabGroupData,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { asWritten } from '../setup/asWritten';
import { channels } from '../setup/hexColor';

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
    onOpenWindow?: () => void;
    onUpdateWindowGroupTitle?: (title: string) => void;
  },
  { hasTabGroupsPermission = true }: { hasTabGroupsPermission?: boolean } = {}
) {
  return renderWithProviders(
    <WindowEntryContainer
      number={1}
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      onOpenWindow={() => undefined}
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
    const [r, g, b] = channels(TAB_GROUP_COLOR_HEX.blue);
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
    const [r, g, b] = channels(TAB_GROUP_COLOR_HEX.grey);
    expect(getComputedStyle(band as Element).backgroundColor).toBe(
      `rgb(${r}, ${g}, ${b})`
    );
  });
});

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
});

// The tick commits, and its click reaches nothing that replaced it (window-rows.spec covers Chrome).
describe('finishing a window rename', () => {
  test('the tick commits and leaves the editor closed', async () => {
    const user = userEvent.setup();
    const onOpenWindow = vi.fn();
    const onUpdateWindowGroupTitle = vi.fn();
    await renderWindow({
      tabs: [
        { tabId: 't1', favicon: '', title: 'Inbox', url: 'https://a.test' },
      ],
      onOpenWindow,
      onUpdateWindowGroupTitle,
    });

    await user.click(
      screen.getByRole('button', { name: 'Rename window: Window 1' })
    );
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Trip');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onUpdateWindowGroupTitle).toHaveBeenCalledWith('Trip');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Rename window: Window 1' })
    ).toBeInTheDocument();
    expect(onOpenWindow).not.toHaveBeenCalled();
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
      screen.getByRole('button', { name: 'Rename window: Window 1' })
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

    // KAN-720. The count tag follows the title and now carries the 9px.
    const tag = document.querySelector('[data-row-tag]');
    expect(tag).not.toBeNull();
    expect(getComputedStyle(tag!.parentElement!).paddingRight).toBe('9px');
  });
});

// KAN-394. An unnamed window is drawn as "Window N", muted; a name is drawn as text.
describe('the window label', () => {
  const renderLabelled = (
    title: string,
    { searching = false }: { searching?: boolean } = {}
  ) =>
    renderWithProviders(
      <WindowEntryContainer
        number={2}
        title={title}
        tabGroupId="tg1"
        windowId="w2"
        tabs={[
          { tabId: 't1', favicon: '', title: 'Inbox', url: 'https://a.test' },
        ]}
        onOpenWindow={() => undefined}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={() => undefined}
      />,
      {
        seedStore: (store) => {
          if (searching) store.dispatch(setSearchInputText('inbox'));
        },
      }
    );

  test('a whitespace-only title is unnamed too', async () => {
    await renderLabelled('   ');

    expect(
      screen.getByRole('button', { name: 'Rename window: Window 2' })
    ).toBeInTheDocument();
  });

  // R7: searching, the title is still the rename button.
  test('while searching, the label is muted the same way', async () => {
    await renderLabelled('', { searching: true });

    expect(
      screen.getByRole('button', { name: 'Rename window: Window 2' })
    ).toBeInTheDocument();
    expect(getComputedStyle(screen.getByText('Window 2')).color).toMatch(
      asWritten(LIGHT_THEME.LABEL_L2_COLOR)
    );
  });

  test('the chevron names an unnamed window by its label', async () => {
    await renderLabelled('');

    expect(
      screen.getByRole('button', { name: 'Collapse: Window 2', expanded: true })
    ).toBeInTheDocument();
  });
});

// KAN-394 P2. The title renames the window; the Open button opens it.
describe('the title renames, Open opens', () => {
  const renderRow = (
    title: string,
    { searching = false }: { searching?: boolean } = {}
  ) => {
    const onOpenWindow = vi.fn();
    const onUpdateWindowGroupTitle = vi.fn();
    const rendered = renderWithProviders(
      <WindowEntryContainer
        number={2}
        title={title}
        tabGroupId="tg1"
        windowId="w2"
        tabs={[
          { tabId: 't1', favicon: '', title: 'Inbox', url: 'https://a.test' },
        ]}
        onOpenWindow={onOpenWindow}
        onUpdateWindowGroupTitle={onUpdateWindowGroupTitle}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={() => undefined}
      />,
      {
        seedStore: (store) => {
          if (searching) store.dispatch(setSearchInputText('inbox'));
        },
      }
    );
    return { rendered, onOpenWindow, onUpdateWindowGroupTitle };
  };

  test('a title click opens the editor and never opens the window', async () => {
    const user = userEvent.setup();
    const { rendered, onOpenWindow } = renderRow('Research');
    await rendered;

    await user.click(
      screen.getByRole('button', { name: 'Rename window: Research' })
    );

    expect(screen.getByRole('textbox')).toHaveValue('Research');
    expect(onOpenWindow).not.toHaveBeenCalled();
  });

  test('Open opens the window, once, and is named by the label (2.5.3)', async () => {
    const user = userEvent.setup();
    const { rendered, onOpenWindow } = renderRow('');
    await rendered;

    const open = screen.getByRole('button', {
      name: 'Open in new window: Window 2',
    });
    expect(open).toHaveTextContent('Open');
    expect(open).toHaveAttribute('data-tooltip', 'Open in new window');
    await user.click(open);

    expect(onOpenWindow).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('while searching the title still renames, and there is no Open', async () => {
    const user = userEvent.setup();
    const { rendered, onOpenWindow } = renderRow('Research', {
      searching: true,
    });
    await rendered;

    expect(
      screen.queryAllByRole('button', { name: /Open in new window/ })
    ).toEqual([]);
    await user.click(
      screen.getByRole('button', { name: 'Rename window: Research' })
    );
    expect(screen.getByRole('textbox')).toHaveValue('Research');
    expect(onOpenWindow).not.toHaveBeenCalled();
  });

  // A blur in the same batch as the Esc still sees the open editor; the ref stops it.
  test('a blur that lands before the cancel renders commits nothing', async () => {
    const user = userEvent.setup();
    const { rendered, onUpdateWindowGroupTitle } = renderRow('Research');
    await rendered;
    await user.click(
      screen.getByRole('button', { name: 'Rename window: Research' })
    );
    await user.type(screen.getByRole('textbox'), ' notes');
    const input = screen.getByRole('textbox');

    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.blur(input);
    });

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onUpdateWindowGroupTitle).not.toHaveBeenCalled();
  });

  test('an Esc that ends an IME composition leaves the editor open', async () => {
    const user = userEvent.setup();
    const { rendered, onUpdateWindowGroupTitle } = renderRow('Research');
    await rendered;
    await user.click(
      screen.getByRole('button', { name: 'Rename window: Research' })
    );

    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Escape',
      isComposing: true,
    });

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(onUpdateWindowGroupTitle).not.toHaveBeenCalled();
  });

  test('an Enter that ends an IME composition commits nothing', async () => {
    const user = userEvent.setup();
    const { rendered, onUpdateWindowGroupTitle } = renderRow('Research');
    await rendered;
    await user.click(
      screen.getByRole('button', { name: 'Rename window: Research' })
    );
    await user.type(screen.getByRole('textbox'), ' notes');

    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      isComposing: true,
    });

    expect(screen.getByRole('textbox')).toHaveValue('Research notes');
    expect(onUpdateWindowGroupTitle).not.toHaveBeenCalled();
  });

  test('Enter on an empty field over a named window commits ""', async () => {
    const user = userEvent.setup();
    const { rendered, onUpdateWindowGroupTitle } = renderRow('Research');
    await rendered;

    await user.click(
      screen.getByRole('button', { name: 'Rename window: Research' })
    );
    await user.clear(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');

    expect(onUpdateWindowGroupTitle).toHaveBeenCalledExactlyOnceWith('');
  });

  test('an unnamed window opens an empty field with "Name this window" as its placeholder', async () => {
    const user = userEvent.setup();
    await renderRow('').rendered;

    await user.click(
      screen.getByRole('button', { name: 'Rename window: Window 2' })
    );

    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Name this window'
    );
  });

  test('a window stored as whitespace opens an empty field, not the spaces (D2, R5)', async () => {
    const user = userEvent.setup();
    await renderRow('   ').rendered;

    await user.click(
      screen.getByRole('button', { name: 'Rename window: Window 2' })
    );

    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Name this window'
    );
  });

  test('a cleared named window shows "Name this window", never its name', async () => {
    const user = userEvent.setup();
    await renderRow('Research').rendered;

    await user.click(
      screen.getByRole('button', { name: 'Rename window: Research' })
    );

    expect(screen.getByRole('textbox')).toHaveValue('Research');
    await user.clear(screen.getByRole('textbox'));

    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Name this window'
    );
  });
});

describe('a pinned saved tab (KAN-458)', () => {
  const tabs: tabData[] = [
    {
      tabId: 't1',
      favicon: '',
      title: 'Inbox',
      url: 'https://a.test',
      pinned: true,
    },
    { tabId: 't2', favicon: '', title: 'Docs', url: 'https://b.test' },
  ];

  test("shows a pin at the row's end, after the title's box, as Open now does (KAN-566)", async () => {
    await renderWindow({ tabs });

    const row = screen.getByRole('button', { name: 'Open in new tab: Inbox' });
    const mark = row.querySelector('[data-pin]');
    if (!(mark instanceof HTMLElement)) throw new Error('no pin mark');
    const title = within(row).getByText('Inbox');
    const titleBox = title.parentElement?.parentElement;

    // Not inside the title's box, but the row's last item, after it.
    expect(titleBox?.contains(mark)).toBe(false);
    expect(mark.parentElement?.parentElement).toBe(row);
    expect(mark.parentElement?.nextElementSibling).toBeNull();
    expect(
      title.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const glyph = within(mark).getByText('keep');
    expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(getComputedStyle(glyph).color).toMatch(
      asWritten(LIGHT_THEME.LABEL_L2_COLOR)
    );
    // The owner's pick (B); jsdom resolves rem against the 16px root.
    expect(getComputedStyle(glyph).fontSize).toBe('16px');
  });

  test('is described "Pinned", as Open now describes a pinned tab (KAN-307); the name is unchanged', async () => {
    await renderWindow({ tabs });

    const row = screen.getByRole('button', { name: 'Open in new tab: Inbox' });
    expect(row).toHaveAccessibleDescription('Pinned');
  });

  test('CONTROL: an unpinned tab has no pin and no description', async () => {
    await renderWindow({ tabs });

    const row = screen.getByRole('button', { name: 'Open in new tab: Docs' });
    expect(row.querySelector('[data-pin]')).toBeNull();
    expect(row).not.toHaveAttribute('aria-describedby');
  });
});

describe('a saved split pair (KAN-564, pick A)', () => {
  const tab = (tabId: string, title: string, extra: Partial<tabData> = {}) => ({
    tabId,
    favicon: '',
    title,
    url: `https://${tabId}.test`,
    ...extra,
  });
  const row = (title: string) =>
    screen.getByRole('button', { name: `Open in new tab: ${title}` });

  test('both halves show the split mark after the title, described and titled with the other half', async () => {
    await renderWindow({
      tabs: [
        tab('t1', 'Docs'),
        tab('t2', 'Wiki', { splitId: 's1' }),
        tab('t3', 'Guide', { splitId: 's1' }),
      ],
    });

    for (const [title, other] of [
      ['Wiki', 'Guide'],
      ['Guide', 'Wiki'],
    ]) {
      const mark = row(title).querySelector('[data-split]');
      if (!(mark instanceof HTMLElement))
        throw new Error(`no mark on ${title}`);
      const glyph = within(mark).getByText('view_column_2');
      expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(mark.querySelector('[data-tooltip]')).toHaveAttribute(
        'data-tooltip',
        `In a split view with “${other}”`
      );
      expect(row(title)).toHaveAccessibleDescription(
        `In a split view with “${other}”`
      );
    }
    expect(row('Docs').querySelector('[data-split]')).toBeNull();
  });

  test('a pinned half reads both, Pinned first', async () => {
    await renderWindow({
      tabs: [
        tab('t1', 'Wiki', { splitId: 's1', pinned: true }),
        tab('t2', 'Guide', { splitId: 's1', pinned: true }),
      ],
    });
    expect(row('Wiki')).toHaveAccessibleDescription(
      'Pinned In a split view with “Guide”'
    );
  });

  test('CONTROL: a pair a restore would not split shows no mark', async () => {
    await renderWindow({
      tabs: [
        tab('t1', 'Wiki', { splitId: 's1' }),
        tab('t2', 'Docs'),
        tab('t3', 'Guide', { splitId: 's1' }),
      ],
    });
    for (const title of ['Wiki', 'Guide']) {
      expect(row(title).querySelector('[data-split]')).toBeNull();
      expect(row(title)).not.toHaveAttribute('aria-describedby');
    }
  });
});

// KAN-708. Right-clicking a saved window or a saved group header opens that row's ⋮ items.
describe('right-click (KAN-708)', () => {
  const t = (tabId: string, url: string, chromeGroupId?: string): tabData => ({
    tabId,
    favicon: '',
    title: tabId,
    url,
    ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
  });
  // Unsorted by site, with a duplicate in the window and one inside group g1.
  const TABS = [
    t('b1', 'https://b.test/'),
    t('a1', 'https://a.test/', 'g1'),
    t('a2', 'https://a.test/', 'g1'),
    t('c1', 'https://c.test/', 'g2'),
  ];
  const GROUPS: chromeTabGroupData[] = [
    { groupId: 'g1', title: 'Work', color: 'blue' },
    { groupId: 'g2', title: 'Play', color: 'red' },
  ];

  async function renderSeeded({
    searching = false,
    onDeleteClick = () => undefined,
  }: { searching?: boolean; onDeleteClick?: () => void } = {}) {
    return renderWithProviders(
      <WindowEntryContainer
        number={1}
        title="Window 1"
        tabGroupId="tg1"
        windowId="w1"
        tabs={TABS}
        chromeTabGroups={GROUPS}
        onOpenWindow={() => undefined}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={onDeleteClick}
      />,
      {
        seedStore: (store) => {
          store.dispatch(setHasTabGroupsPermission(true));
          store.dispatch(
            replaceState(
              buildContainer([
                buildSession({
                  tabGroupId: 'tg1',
                  windows: [
                    {
                      windowId: 'w1',
                      windowHeight: 1080,
                      windowWidth: 1920,
                      windowOffsetTop: 0,
                      windowOffsetLeft: 0,
                      tabCount: TABS.length,
                      title: 'Window 1',
                      tabs: TABS,
                      chromeTabGroups: GROUPS,
                    },
                  ],
                }),
              ])
            )
          );
          if (searching) store.dispatch(setSearchInputText('test'));
        },
      }
    );
  }

  const menus = () => [
    ...document.querySelectorAll<HTMLElement>('[data-row-menu]'),
  ];
  const labels = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => {
        // The glyph's ligature text is aria-hidden; the label is what is left.
        const copy = item.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('[aria-hidden]').forEach((n) => n.remove());
        return copy.textContent;
      });
  const windowTitle = () =>
    screen.getByRole('button', { name: 'Rename window: Window 1' });
  const groupTitle = (name: string) =>
    screen.getByRole('button', { name: `Rename group: ${name}` });
  const esc = () =>
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
  const groupsOf = (store: Awaited<ReturnType<typeof renderSeeded>>['store']) =>
    store
      .getState()
      .tabContainerDataState.tabGroups[0].windows[0].chromeTabGroups?.map(
        (g) => g.groupId
      );

  test("a window row's right-click offers its ⋮ items in order", async () => {
    const user = userEvent.setup();
    await renderSeeded();

    expect(fireEvent.contextMenu(windowTitle())).toBe(false);
    const rowItems = labels(menus()[0]);
    esc();
    expect(menus()).toHaveLength(0);

    // The window's ⋮ is the first of the page's.
    await user.click(
      screen.getAllByRole('button', { name: 'More actions' })[0]
    );
    const dotsItems = labels(screen.getByRole('menu', { name: /./ }));

    expect(rowItems).toEqual([
      'Sort tabs by site',
      'Sort groups by name',
      'Remove 1 duplicate tab',
      'Delete window',
    ]);
    expect(rowItems).toEqual(dotsItems);
  });

  test('Delete window calls onDeleteClick', async () => {
    const onDeleteClick = vi.fn();
    await renderSeeded({ onDeleteClick });

    fireEvent.contextMenu(windowTitle());
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Delete window/ })
    );

    expect(onDeleteClick).toHaveBeenCalledTimes(1);
  });

  test("a group header's right-click offers Ungroup / Remove duplicates / Delete tab group, acting on that group", async () => {
    const { store } = await renderSeeded();

    fireEvent.contextMenu(groupTitle('Work'));
    expect(menus()[0]).toHaveAccessibleName('More actions: Work');
    expect(labels(menus()[0])).toEqual([
      'Ungroup',
      'Remove 1 duplicate tab',
      'Delete tab group',
    ]);
    esc();

    // Play has no duplicate; its menu is its own.
    fireEvent.contextMenu(groupTitle('Play'));
    expect(labels(menus()[0])).toEqual(['Ungroup', 'Delete tab group']);
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: 'Delete tab group' })
    );
    expect(groupsOf(store)).toEqual(['g1']);
  });

  test("while renaming the window, the rename input keeps Chrome's menu, and the row gives Chrome's menu too", async () => {
    const user = userEvent.setup();
    await renderSeeded();
    await user.click(windowTitle());
    const input = screen.getByRole('textbox');
    const tick = screen.getByRole('button', { name: 'Save changes' });

    expect(fireEvent.contextMenu(input)).toBe(true);
    expect(fireEvent.contextMenu(tick)).toBe(true);
    expect(menus()).toHaveLength(0);
  });

  test('right-clicking another row while a group rename is open opens that row’s menu', async () => {
    const user = userEvent.setup();
    await renderSeeded();
    await user.click(groupTitle('Work'));
    const input = screen.getByRole('textbox', { name: 'Rename group: Work' });

    expect(fireEvent.contextMenu(input)).toBe(true);
    expect(menus()).toHaveLength(0);

    // The other group and the window row answer while Work is renamed.
    expect(fireEvent.contextMenu(groupTitle('Play'))).toBe(false);
    expect(menus()[0]).toHaveAccessibleName('More actions: Play');
    esc();
    expect(fireEvent.contextMenu(windowTitle())).toBe(false);
    expect(menus()[0]).toHaveAccessibleName('More actions: Window 1');
  });

  test("while searching, both give Chrome's menu", async () => {
    await renderSeeded({ searching: true });

    expect(fireEvent.contextMenu(windowTitle())).toBe(true);
    expect(fireEvent.contextMenu(groupTitle('Work'))).toBe(true);
    expect(menus()).toHaveLength(0);
  });

  test("right-clicking the row's own ⋮ or Open button opens the row's menu, not Chrome's", async () => {
    await renderSeeded();
    const openWindow = screen.getByRole('button', {
      name: 'Open in new window: Window 1',
    });
    const windowDots = screen.getAllByRole('button', {
      name: 'More actions',
    })[0];

    expect(fireEvent.contextMenu(openWindow)).toBe(false);
    expect(menus()[0]).toHaveAccessibleName('More actions: Window 1');
    esc();
    expect(fireEvent.contextMenu(windowDots)).toBe(false);
    expect(menus()[0]).toHaveAccessibleName('More actions: Window 1');
    esc();

    const openGroup = screen.getByRole('button', { name: 'Open group: Work' });
    expect(fireEvent.contextMenu(openGroup)).toBe(false);
    expect(menus()[0]).toHaveAccessibleName('More actions: Work');
  });

  // The strip's resting rule is the first `> *` rule emotion wrote for it.
  const stripOpacity = (strip: Element) =>
    />\*\s*\{[^}]*?opacity:\s*(\d)/.exec(classRulesFor(strip))?.[1];

  test('held: the strip shows for the held row with the pointer elsewhere', async () => {
    await renderSeeded();
    const row = () =>
      windowTitle().closest('[data-window-drag-handle]') as HTMLElement;
    const strip = () =>
      row().querySelector('[data-row-actions]') as HTMLElement;

    expect(stripOpacity(strip())).toBe('0');
    fireEvent.contextMenu(windowTitle());
    expect(stripOpacity(strip())).toBe('1');
    expect(row()).toHaveAttribute('data-row-menu-held');
    esc();
    expect(stripOpacity(strip())).toBe('0');
    expect(row()).not.toHaveAttribute('data-row-menu-held');
  });

  test('held: a group header shows its strip for the held group only', async () => {
    await renderSeeded();
    // A rule that names the strip with no hover or focus condition on it.
    const shownAtRest = (header: Element) =>
      classRulesFor(header)
        .split('{')
        .map((chunk) => chunk.split('}').pop() ?? '')
        .some((sel) => /\.group-actions\s*$/.test(sel) && !sel.includes(':'));
    const header = (name: string) =>
      groupTitle(name).closest('[data-group-drag-handle]') as HTMLElement;

    expect(shownAtRest(header('Work'))).toBe(false);
    // The group's own ⋮ open is not a hold: it only lifts the strip's z-index.
    const workDots = within(header('Work')).getByRole('button', {
      name: 'More actions',
    });
    fireEvent.click(workDots);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(shownAtRest(header('Work'))).toBe(false);
    esc();
    fireEvent.contextMenu(groupTitle('Work'));
    expect(shownAtRest(header('Work'))).toBe(true);
    expect(shownAtRest(header('Play'))).toBe(false);
    esc();
    expect(shownAtRest(header('Work'))).toBe(false);
  });
});
