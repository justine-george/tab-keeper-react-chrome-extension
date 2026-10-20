import { describe, expect, test } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import OverflowMenu from '../../components/common/OverflowMenu';
import GroupColorPicker from '../../components/common/GroupColorPicker';
import type { OverflowMenuItem } from '../../components/common/MenuPanel';
import { useRowContextMenu } from '../../components/common/rowMenu/useRowContextMenu';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-708. One menu open at a time across a ⋮ (or the colour picker) and a row's right-click menu.

const items: OverflowMenuItem[] = [
  { key: 'x', label: 'Delete', icon: 'delete', onSelect: () => undefined },
];

function Row() {
  const m = useRowContextMenu({
    kind: 'savedWindow',
    ariaLabel: () => 'Row menu',
    itemsFor: () => items,
  });
  return (
    <>
      <div data-testid="row" {...m.rowProps('w1')}>
        <span>Title</span>
        <OverflowMenu ariaLabel="More actions" items={items} />
        <GroupColorPicker
          color="blue"
          ariaLabel="Change group color"
          onSelect={() => undefined}
        />
      </div>
      {m.menu}
    </>
  );
}

const openMenus = () =>
  screen.getAllByRole('menu').map((m) => m.getAttribute('aria-label'));
const dots = () => screen.getByRole('button', { name: 'More actions' });
const band = () => screen.getByRole('button', { name: 'Change group color' });

describe('one menu open at a time', () => {
  test('a right press on the open ⋮’s own trigger swaps it for the row menu', async () => {
    await renderWithProviders(<Row />);
    fireEvent.click(dots());
    expect(openMenus()).toEqual(['More actions']);
    fireEvent.mouseDown(dots(), { button: 2 });
    fireEvent.contextMenu(dots(), { clientX: 5, clientY: 5 });
    expect(openMenus()).toEqual(['Row menu']);
    expect(dots()).toHaveAttribute('aria-expanded', 'false');
  });

  test('CONTROL: a right press on the row title with the ⋮ open', async () => {
    await renderWithProviders(<Row />);
    fireEvent.click(dots());
    const title = screen.getByText('Title');
    fireEvent.mouseDown(title, { button: 2 });
    fireEvent.contextMenu(title, { clientX: 5, clientY: 5 });
    expect(openMenus()).toEqual(['Row menu']);
  });

  test('the row menu open, Tab to the ⋮ and Enter: only the ⋮ is open', async () => {
    await renderWithProviders(<Row />);
    fireEvent.contextMenu(screen.getByText('Title'), {
      clientX: 5,
      clientY: 5,
    });
    expect(openMenus()).toEqual(['Row menu']);
    act(() => dots().focus());
    fireEvent.click(dots(), { detail: 0 });
    expect(openMenus()).toEqual(['More actions']);
  });

  test('the colour picker obeys it too, both ways', async () => {
    await renderWithProviders(<Row />);
    // The swatch menu is unnamed: its trigger's aria-expanded says it is the one open.
    fireEvent.click(band());
    expect(openMenus()).toEqual([null]);
    expect(band()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.contextMenu(screen.getByText('Title'), {
      clientX: 5,
      clientY: 5,
    });
    expect(openMenus()).toEqual(['Row menu']);
    expect(band()).toHaveAttribute('aria-expanded', 'false');

    act(() => band().focus());
    fireEvent.keyDown(band(), { key: 'Enter' });
    expect(openMenus()).toEqual([null]);
    expect(band()).toHaveAttribute('aria-expanded', 'true');
  });
});
