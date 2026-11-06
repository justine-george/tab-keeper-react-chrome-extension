import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  MenuPanel,
  type MenuColorRow,
} from '../../components/common/MenuPanel';
import type { OverflowMenuItem } from '../../components/common/MenuPanel';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-936. The group title menus' swatch row.

const tile: OverflowMenuItem = {
  key: 'open',
  actionRowLabel: 'Open',
  label: 'Open group',
  icon: 'reopen_window',
  onSelect: () => undefined,
};
const listItem: OverflowMenuItem = {
  key: 'ungroup',
  label: 'Ungroup',
  icon: 'label_off',
  onSelect: () => undefined,
};

function setup(items: OverflowMenuItem[], color = 'blue') {
  const onPick = vi.fn<MenuColorRow['onPick']>();
  const close = vi.fn();
  const registered: (HTMLElement | null)[] = [];
  const panel = (
    <MenuPanel
      ariaLabel="More actions"
      items={items}
      colorRow={{ ariaLabel: 'Change group color', color, onPick }}
      registerItem={(index) => (el) => {
        registered[index] = el;
      }}
      handleKeyDown={() => undefined}
      close={close}
      positionCss=""
    />
  );
  return { panel, onPick, close, registered };
}

const row = () => screen.getByRole('group', { name: 'Change group color' });
const swatch = (name: string) =>
  within(row()).getByRole('menuitemradio', { name });

describe('the menu color row', () => {
  it("offers Chrome's nine colors in the picker's order, the group's checked", async () => {
    const { panel } = setup([listItem]);
    await renderWithProviders(panel);
    const swatches = within(row()).getAllByRole('menuitemradio');
    expect(swatches.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Gray',
      'Blue',
      'Red',
      'Yellow',
      'Green',
      'Pink',
      'Purple',
      'Cyan',
      'Orange',
    ]);
    expect(
      swatches.filter((s) => s.getAttribute('aria-checked') === 'true')
    ).toEqual([swatch('Blue')]);
  });

  it('a stored color Chrome does not have reads as gray', async () => {
    const { panel } = setup([listItem], 'mauve');
    await renderWithProviders(panel);
    expect(swatch('Gray')).toHaveAttribute('aria-checked', 'true');
  });

  it('a pick reports the color and leaves the menu open', async () => {
    const { panel, onPick, close } = setup([listItem]);
    await renderWithProviders(panel);
    fireEvent.click(swatch('Red'));
    expect(onPick).toHaveBeenCalledWith('red', expect.any(Number));
    expect(close).not.toHaveBeenCalled();
  });

  it('every pick in one open menu carries one run', async () => {
    const { panel, onPick } = setup([listItem]);
    await renderWithProviders(panel);
    fireEvent.click(swatch('Red'));
    fireEvent.click(swatch('Green'));
    const [first, second] = onPick.mock.calls;
    expect(first[1]).toBe(second[1]);
  });

  it('a menu opened again carries a new run', async () => {
    const { panel, onPick } = setup([listItem]);
    const first = await renderWithProviders(panel);
    fireEvent.click(swatch('Red'));
    first.unmount();
    await renderWithProviders(panel);
    fireEvent.click(swatch('Green'));
    const [before, after] = onPick.mock.calls;
    expect(before[1]).not.toBe(after[1]);
  });

  it('sits under the tile row, above the list, and takes the indexes between them', async () => {
    const { panel, registered } = setup([tile, listItem]);
    await renderWithProviders(panel);
    expect(
      registered.map((el) => el?.getAttribute('aria-label') ?? el?.textContent)
    ).toEqual([
      'Open',
      'Gray',
      'Blue',
      'Red',
      'Yellow',
      'Green',
      'Pink',
      'Purple',
      'Cyan',
      'Orange',
      expect.stringContaining('Ungroup'),
    ]);
  });

  it('a press on a swatch stays in the menu: a row under it hears nothing', async () => {
    const onRowClick = vi.fn();
    const { panel } = setup([listItem]);
    await renderWithProviders(<div onClick={onRowClick}>{panel}</div>);
    fireEvent.click(swatch('Red'));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
