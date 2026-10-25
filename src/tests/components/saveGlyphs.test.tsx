import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Icon from '../../components/common/Icon';
import OverflowMenu from '../../components/common/OverflowMenu';
import { SAVE_OF } from '../../components/home/leftpane/saveScopes';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-780. Each save's glyph is a custom SVG: Save current is a window with a
// plus badge, Save all two windows with the same badge. Material Symbols has
// neither, and a name the font lacks prints as its letters, so these check an
// <svg> was drawn and the name was not.

const SCOPES = [
  ['current-window', 'window_add'],
  ['all-windows', 'two_windows_add'],
] as const;

const pathOf = (root: ParentNode) =>
  root.querySelector('svg path')?.getAttribute('d');

describe('the save glyphs (KAN-780)', () => {
  test.each(SCOPES)('%s draws %s as an svg path', async (scope, name) => {
    expect(SAVE_OF[scope].icon).toBe(name);
    const { container } = await renderWithProviders(
      <Icon type={SAVE_OF[scope].icon} onClick={() => {}} ariaLabel="Save" />
    );

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('data-icon')).toBe(name);
    expect(pathOf(container)).toMatch(/^M[\d.]/);
    expect(container.querySelector('.material-symbols-outlined')).toBeNull();
    expect(container.textContent).not.toContain(name);
  });

  test('the two saves draw different paths', async () => {
    const { container: current } = await renderWithProviders(
      <Icon type={SAVE_OF['current-window'].icon} />
    );
    const { container: all } = await renderWithProviders(
      <Icon type={SAVE_OF['all-windows'].icon} />
    );
    expect(pathOf(current)).not.toBe(pathOf(all));
  });

  // CONTROL: a ligature still draws from the font, and is named the same way.
  test('CONTROL: a ligature is a span carrying its name', async () => {
    const { container } = await renderWithProviders(<Icon type="add_box" />);

    const span = container.querySelector('.material-symbols-outlined');
    expect(span?.getAttribute('data-icon')).toBe('add_box');
    expect(span?.textContent).toBe('add_box');
    expect(container.querySelector('svg')).toBeNull();
  });

  test('a menu item draws an svg glyph in the glyph column, and only its label as text', async () => {
    await renderWithProviders(
      <OverflowMenu
        ariaLabel="More actions"
        items={[
          {
            key: 'save',
            label: 'Save current window as a session',
            icon: SAVE_OF['current-window'].icon,
            onSelect: () => {},
          },
          { key: 'pdf', label: 'PDF', icon: 'ios_share', onSelect: () => {} },
        ]}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));

    const [save, pdf] = screen.getAllByRole('menuitem');
    const glyph = save.querySelector('.overflow-menu-glyph');
    expect(glyph?.tagName.toLowerCase()).toBe('svg');
    expect(glyph?.getAttribute('data-icon')).toBe('window_add');
    expect(save.textContent).toBe('Save current window as a session');
    // CONTROL: the ligature item beside it is unchanged.
    expect(pdf.querySelector('.overflow-menu-glyph')?.textContent).toBe(
      'ios_share'
    );
  });
});
