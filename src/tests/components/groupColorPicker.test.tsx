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
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import type { chromeTabGroupData } from '../../redux/slices/tabContainerDataStateSlice';

// The coloured band, which used to be aria-hidden decoration and is now the
// trigger for a colour picker. The reducer is covered in
// chromeGroupActions.test.ts; what is under test here is the control -- that
// it is named, that it offers Chrome's colours in Chrome's order, that it
// hands the right ids to the right action, and that widening it on hover
// cannot shove the rows beside it sideways.

const TABS = [
  {
    tabId: 'g1',
    favicon: '',
    title: 'One',
    url: 'https://b.co',
    chromeGroupId: 'grp',
  },
  {
    tabId: 'g2',
    favicon: '',
    title: 'Two',
    url: 'https://c.co',
    chromeGroupId: 'grp',
  },
];

const BAND = 'Change group color: Research';

async function renderGroup({
  color = 'blue',
  title = 'Research',
  isSearchPanel = false,
} = {}) {
  const groups: chromeTabGroupData[] = [{ groupId: 'grp', title, color }];
  return renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg"
      windowId="w"
      tabs={TABS}
      chromeTabGroups={groups}
      onWindowTitleClick={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        if (isSearchPanel) store.dispatch(openSearchPanel());
        store.dispatch(
          saveToTabContainerInternal({
            tabGroupId: 'tg',
            title: 'Session',
            createdTime: '2026-09-06 00:00:00',
            windowCount: 1,
            tabCount: 2,
            isAutoSave: false,
            isSelected: false,
            windows: [
              {
                windowId: 'w',
                windowHeight: 100,
                windowWidth: 100,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 2,
                title: 'Window 1',
                tabs: TABS,
                chromeTabGroups: groups,
              },
            ],
          })
        );
      },
    }
  );
}

type S = Awaited<ReturnType<typeof renderGroup>>['store'];
const colourOf = (store: S) =>
  store.getState().tabContainerDataState.tabGroups[0].windows[0]
    .chromeTabGroups![0].color;

describe('the group colour band', () => {
  test('is a named control, not decoration', async () => {
    await renderGroup();

    const band = screen.getByRole('button', { name: BAND });
    expect(band).toHaveAttribute('aria-haspopup', 'menu');
    expect(band).toHaveAttribute('aria-expanded', 'false');
  });

  // WCAG 2.5.3: the accessible name has to contain the visible label. An
  // untitled group shows the placeholder, so the band has to say that too --
  // "Change group color" alone is ambiguous the moment a window holds two
  // groups.
  test('names an untitled group by its visible placeholder', async () => {
    await renderGroup({ title: '' });

    expect(
      screen.getByRole('button', { name: 'Change group color: Unnamed group' })
    ).toBeInTheDocument();
  });

  test('opens Chrome nine colours, in Chrome order', async () => {
    const user = userEvent.setup();
    await renderGroup();

    await user.click(screen.getByRole('button', { name: BAND }));

    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((s) => s.getAttribute('aria-label'))
    ).toEqual([
      'Grey',
      'Blue',
      'Red',
      'Yellow',
      'Green',
      'Pink',
      'Purple',
      'Cyan',
      'Orange',
    ]);
  });

  test('marks the group current colour', async () => {
    const user = userEvent.setup();
    await renderGroup({ color: 'green' });

    await user.click(screen.getByRole('button', { name: BAND }));

    expect(
      screen.getByRole('menuitemradio', { name: 'Green' })
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Blue' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  // A stored colour Chrome does not have already renders as grey; the picker
  // has to agree with the band, or the marked swatch and the painted band
  // disagree in front of the user.
  test('an unrecognised stored colour marks grey', async () => {
    const user = userEvent.setup();
    await renderGroup({ color: 'octarine' });

    await user.click(screen.getByRole('button', { name: BAND }));

    expect(screen.getByRole('menuitemradio', { name: 'Grey' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  // The marker has to sit on the MENU SURFACE, not on the pastel. The token
  // used for it measures 1.10-2.00:1 against the nine Chrome fills on the
  // default Light theme, so a thickened border -- which is what the Settings
  // theme swatches use -- leaves the purple swatch unmarked. An offset ring
  // puts it back on the surface the token was measured against.
  test('marks the active swatch with a ring set off from the fill', async () => {
    const user = userEvent.setup();
    await renderGroup({ color: 'green' });

    await user.click(screen.getByRole('button', { name: BAND }));

    const active = screen.getByRole('menuitemradio', { name: 'Green' });
    const idle = screen.getByRole('menuitemradio', { name: 'Purple' });

    // A gap in the surface colour, then the marker itself. Pinned to the
    // tokens, because the point of the offset is WHICH backdrop the ring
    // lands on -- a regex on the geometry alone would pass with the ring
    // drawn in any colour at all.
    expect(getComputedStyle(active).boxShadow.replace(/\s+/g, ' ')).toBe(
      `0 0 0 2px ${LIGHT_THEME.PRIMARY_COLOR.toLowerCase()},` +
        `0 0 0 4px ${LIGHT_THEME.LABEL_L3_COLOR.toLowerCase()}`
    );
    expect(getComputedStyle(idle).boxShadow).toBe('none');
  });

  // box-shadow, not a thicker border: the swatch must not change size as
  // selection moves, or the eight others shuffle sideways under the pointer.
  test('the marker costs the swatch no size', async () => {
    const user = userEvent.setup();
    await renderGroup({ color: 'green' });

    await user.click(screen.getByRole('button', { name: BAND }));

    const active = getComputedStyle(
      screen.getByRole('menuitemradio', { name: 'Green' })
    );
    const idle = getComputedStyle(
      screen.getByRole('menuitemradio', { name: 'Purple' })
    );
    expect(active.width).toBe(idle.width);
    expect(active.borderTopWidth).toBe(idle.borderTopWidth);
  });

  test('choosing a colour recolours the group and closes the picker', async () => {
    const user = userEvent.setup();
    const { store } = await renderGroup({ color: 'blue' });

    await user.click(screen.getByRole('button', { name: BAND }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Purple' }));

    expect(colourOf(store)).toBe('purple');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // The band's paint is asserted in WindowEntryContainer.test.tsx, which drives
  // it through the chromeTabGroups PROP. It cannot be asserted here: this
  // harness passes a fixed prop array, so the band would keep its old colour
  // even if the store updated correctly. Verified in a real browser instead,
  // where HeroContainerRight feeds the prop from the store.

  // Measured in Chrome: without this, committing a colour by keyboard left
  // document.activeElement at <body> and the user lost their place in the
  // pane entirely.
  test('committing a colour hands focus back to the band', async () => {
    const user = userEvent.setup();
    await renderGroup();

    await user.click(screen.getByRole('button', { name: BAND }));
    await user.keyboard('{ArrowRight}{Enter}');

    expect(screen.getByRole('button', { name: BAND })).toHaveFocus();
  });

  test('Escape closes the picker and hands focus back to the band', async () => {
    const user = userEvent.setup();
    await renderGroup();

    await user.click(screen.getByRole('button', { name: BAND }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: BAND })).toHaveFocus();
  });

  // Horizontal, because the swatches are laid out in a row. ArrowDown on a row
  // of swatches is the kind of mismatch that only shows up under a screen
  // reader, so the axis is pinned here.
  test('arrow keys walk the swatches sideways and wrap', async () => {
    const user = userEvent.setup();
    await renderGroup();

    await user.click(screen.getByRole('button', { name: BAND }));
    expect(screen.getByRole('menuitemradio', { name: 'Grey' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('menuitemradio', { name: 'Blue' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('menuitemradio', { name: 'Orange' })).toHaveFocus();
  });

  test('a click outside dismisses the picker', async () => {
    const user = userEvent.setup();
    await renderGroup();

    await user.click(screen.getByRole('button', { name: BAND }));
    await user.click(screen.getByRole('button', { name: 'Window 1' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // KAN-62: a control that cannot act must not be focusable. The search panel
  // withholds every other mutating group action, so the band goes back to
  // being the decoration it was.
  test('the search panel leaves the band inert', async () => {
    await renderGroup({ isSearchPanel: true });

    expect(
      screen.queryByRole('button', { name: BAND })
    ).not.toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Research' });
    expect(group.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('widening the band', () => {
  // The footprint arithmetic, which is the whole reason the band can widen at
  // all: 3px + 6px margin at rest, 6px + 3px on hover. jsdom has no :hover and
  // no layout, so this reads the rule Emotion inserted rather than measuring
  // the box. Verified visually in a real browser -- no row moves.
  test('the hover rule keeps the 9px footprint', async () => {
    await renderGroup();

    const band = screen.getByRole('button', { name: BAND });
    const classes = [...band.classList].map((c) => `.${c}`);

    const hoverRules: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of [...rules]) {
        const text = rule.cssText;
        if (text.includes(':hover') && classes.some((c) => text.includes(c)))
          hoverRules.push(text);
      }
    }

    const hover = hoverRules.join('\n');
    expect(hover).toMatch(/width:\s*6px/);
    expect(hover).toMatch(/margin-right:\s*3px/);
  });

  // THE CONTROL. If the resting band were not 3px with a 6px margin, the
  // assertion above would be pinning arithmetic that never adds to 9.
  test('CONTROL: the resting band is 3px with a 6px margin', async () => {
    await renderGroup();

    const style = getComputedStyle(screen.getByRole('button', { name: BAND }));
    expect(style.width).toBe('3px');
    expect(style.marginRight).toBe('6px');
  });
});
