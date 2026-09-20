import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Icon from '../../components/common/Icon';
import Button from '../../components/common/Button';
import OverflowMenu from '../../components/common/OverflowMenu';
import SettingsCategoryContainer from '../../components/settings/leftpane/SettingsCategoryContainer';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import { activeRulesFor, hoverRulesFor } from '../setup/hoverRules';

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

/** A colour as emotion writes it, or as jsdom normalises it. */
const asWritten = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
};

const PRESSED = asWritten(LIGHT_THEME.ACTIVE_COLOR);
const ICON_PRESSED = asWritten(LIGHT_THEME.ICON_ACTIVE_COLOR);
const ICON_HOVER = asWritten(LIGHT_THEME.ICON_HOVER_COLOR);
const DELETE = asWritten(LIGHT_THEME.DELETE_ICON_HOVER_COLOR);

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

  test('a button presses one rung past its hover', async () => {
    await renderWithProviders(<Button onClick={() => undefined} text="Save" />);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(activeRulesFor(button)).toMatch(ICON_PRESSED);
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

  // Measured, not assumed: at the delete hue there is no lightness that both
  // deepens the fill and keeps the dark glyph on it above 4.5:1. A destructive
  // control that gets harder to read as you commit to it is the wrong trade, so
  // it holds its colour instead.
  test('a destructive control holds its red while pressed', async () => {
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
    expect(activeRulesFor(item)).toMatch(DELETE);
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
    const unselected = screen.getByRole('button', { name: 'Sync & Privacy' });
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
