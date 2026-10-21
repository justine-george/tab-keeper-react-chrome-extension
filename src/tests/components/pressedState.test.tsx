import { createRef } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Icon from '../../components/common/Icon';
import OverflowMenu from '../../components/common/OverflowMenu';
import SettingsCategoryContainer from '../../components/settings/leftpane/SettingsCategoryContainer';
import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { toOpenWindows } from '../../utils/functions/openNow';
import type { ChromeSeed } from '../setup/chrome.fake';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import { activeRulesFor, hoverRulesFor } from '../setup/hoverRules';
import { asWritten } from '../setup/asWritten';

// KAN-205. Nothing in this product confirmed a click.
//
// Every interactive surface went rest -> hover -> whatever the click did, so a
// click that took a moment to land was indistinguishable from a click that had
// not registered. The scrollbar was the sole exception, and the only control
// with a consistent three-step ladder across the themes.
//
// A press is now one rung past the hover, from ACTIVE_COLOR for surfaces and
// ICON_ACTIVE_COLOR for icons -- which sit inside rows and so hover harder than
// the row they are in (KAN-93).
//
// Asserted against the injected rules, not a rendered press: jsdom has no
// pointer and cannot enter :active at all, so a computed style reports the
// resting state and would pass against no press rule whatsoever.

const PRESSED = asWritten(LIGHT_THEME.ACTIVE_COLOR);
const ICON_PRESSED = asWritten(LIGHT_THEME.ICON_ACTIVE_COLOR);
const ICON_HOVER = asWritten(LIGHT_THEME.ICON_HOVER_COLOR);
const DANGER_FILL = asWritten(LIGHT_THEME.DANGER_FILL);
const DANGER_PRESSED = asWritten(LIGHT_THEME.DANGER_FILL_DEEP);

describe('a press is confirmed on every interactive surface (KAN-205)', () => {
  test('an actionable icon presses one rung past its hover', async () => {
    await renderWithProviders(
      <Icon type="settings" ariaLabel="Delete" onClick={() => undefined} />
    );

    const icon = screen.getByRole('button', { name: 'Delete' });
    expect(activeRulesFor(icon)).toMatch(ICON_PRESSED);
    // The rungs are distinct: a press that paints the hover colour is not a
    // press at all, and that is exactly what "no :active rule" looks like.
    expect(hoverRulesFor(icon)).toMatch(ICON_HOVER);
    expect(activeRulesFor(icon)).not.toMatch(ICON_HOVER);
  });

  test('a menu item presses, which is where it matters most', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <OverflowMenu
        ariaLabel="More actions"
        items={[
          { key: 'a', label: 'Ungroup', icon: 'label_off', onSelect: vi.fn() },
        ]}
      />
    );
    await user.click(screen.getByRole('button', { name: 'More actions' }));

    // The menu closes on release, so without a press the only feedback a click
    // gets is the menu vanishing.
    expect(
      activeRulesFor(screen.getByRole('menuitem', { name: 'Ungroup' }))
    ).toMatch(PRESSED);
  });

  // KAN-725. White ink holds on the deeper red, so a danger item presses one rung past its fill.
  test('a destructive menu item presses one rung deeper', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <OverflowMenu
        ariaLabel="More actions"
        items={[
          {
            key: 'd',
            label: 'Delete group',
            icon: 'delete',
            danger: true,
            onSelect: vi.fn(),
          },
        ]}
      />
    );
    await user.click(screen.getByRole('button', { name: 'More actions' }));

    const item = screen.getByRole('menuitem', { name: 'Delete group' });
    expect(activeRulesFor(item)).toMatch(DANGER_PRESSED);
    expect(activeRulesFor(item)).not.toMatch(DANGER_FILL);
    expect(activeRulesFor(item)).not.toMatch(PRESSED);
  });

  // THE CONTROL. Every assertion above is satisfied by a stylesheet that
  // mentions the token somewhere; this is what makes them claims about a rule
  // that actually fires on :active.
  // KAN-236. The settings category rows were left out of the sweep above:
  // they had the KAN-96 hover fix and the selected fill, and no press. Found
  // on the settings page after the home page had been fixed. Both rows are
  // checked -- the selected one presses too, as a session row does, since a
  // press is feedback about the pointer and not about selection.
  test('a settings category row presses, selected or not', async () => {
    await renderWithProviders(<SettingsCategoryContainer />);

    const selected = screen.getByRole('button', { name: 'Display' });
    const unselected = screen.getByRole('button', { name: 'Sync & backup' });
    expect(activeRulesFor(unselected)).toMatch(PRESSED);
    expect(activeRulesFor(selected)).toMatch(PRESSED);
    // CONTROL: the unselected row still hovers one rung below its press.
    expect(hoverRulesFor(unselected)).toMatch(
      asWritten(LIGHT_THEME.HOVER_COLOR)
    );
  });

  test('CONTROL: a non-actionable icon gets no press at all', async () => {
    await renderWithProviders(<Icon type="settings" />);

    const icon = document.querySelector('.material-symbols-outlined')!;
    expect(activeRulesFor(icon)).toBe('');
    expect(hoverRulesFor(icon)).toBe('');
  });
});

// KAN-329. KAN-217's held fill is for a MENU trigger: the control that owns
// an open menu. A fold chevron is a disclosure; it says aria-expanded too
// (screen readers need it), but an open window is not a held press. Open
// now's windows start open, so the chevron filled on mount. Read from the
// computed style: jsdom resolves attribute selectors, and neither element
// is hovered or pressed here.
describe('only a menu trigger holds a fill while expanded (KAN-329)', () => {
  test("an open window's fold chevron in Open now shows no pressed fill", async () => {
    const seed: ChromeSeed = {
      windows: [{ id: 1, tabs: [{ title: 'A', url: 'https://a.test/' }] }],
    };
    const result = await renderWithProviders(
      <OpenNowPane
        windows={null}
        actions={[]}
        headingId="h"
        searchText=""
        onSearchTextChange={() => undefined}
        searchInputRef={createRef<HTMLInputElement>()}
      />,
      { seed }
    );
    const windows = toOpenWindows(
      await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
      null,
      null
    );
    result.rerender(
      <OpenNowPane
        windows={windows}
        actions={[]}
        headingId="h"
        searchText=""
        onSearchTextChange={() => undefined}
        searchInputRef={createRef<HTMLInputElement>()}
      />
    );

    // PREMISE: the window is open, and its chevron says so.
    const chevron = screen.getByRole('button', {
      name: 'Collapse: Window 1',
      expanded: true,
    });
    expect(getComputedStyle(chevron).backgroundColor).not.toMatch(ICON_PRESSED);
  });

  test('CONTROL: an open menu trigger still holds the pressed fill (KAN-217)', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <OverflowMenu
        ariaLabel="More actions"
        items={[
          { key: 'a', label: 'Ungroup', icon: 'label_off', onSelect: vi.fn() },
        ]}
      />
    );
    const trigger = screen.getByRole('button', { name: 'More actions' });
    // CONTROL: closed, it rests unfilled.
    expect(getComputedStyle(trigger).backgroundColor).not.toMatch(ICON_PRESSED);

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(getComputedStyle(trigger).backgroundColor).toMatch(ICON_PRESSED);
  });
});
