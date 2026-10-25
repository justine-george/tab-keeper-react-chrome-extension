import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MenuPanel } from '../../components/common/MenuPanel';
import { renderWithProviders } from '../setup/renderWithProviders';

const noRegister = () => () => {};

const panelProps = {
  ariaLabel: 'Row actions',
  items: [
    { key: 'a', label: 'Alpha', icon: 'check' as const, onSelect: vi.fn() },
  ],
  registerItem: noRegister,
  handleKeyDown: vi.fn(),
  close: vi.fn(),
  positionCss: 'position: absolute;',
};

describe('MenuPanel', () => {
  it('a contextmenu on the panel is default-prevented and does not reach a parent listener', async () => {
    const onParentContextMenu = vi.fn();
    await renderWithProviders(
      <div onContextMenu={onParentContextMenu}>
        <MenuPanel {...panelProps} />
      </div>
    );
    const notPrevented = fireEvent.contextMenu(screen.getByText('Alpha'));
    expect(notPrevented).toBe(false);
    expect(onParentContextMenu).not.toHaveBeenCalled();
  });

  it('carries data-row-menu only when asked', async () => {
    await renderWithProviders(
      <>
        <MenuPanel {...panelProps} ariaLabel="Plain" />
        <MenuPanel {...panelProps} ariaLabel="Row" dataRowMenu />
      </>
    );
    expect(screen.getByRole('menu', { name: 'Plain' })).not.toHaveAttribute(
      'data-row-menu'
    );
    expect(screen.getByRole('menu', { name: 'Row' })).toHaveAttribute(
      'data-row-menu'
    );
  });
  // KAN-793. es "Ir a la ventana" is both: a tooltip would only repeat the button.
  it('an action row button whose short label is its whole label has no tooltip or description', async () => {
    await renderWithProviders(
      <MenuPanel
        {...panelProps}
        items={[
          {
            key: 'short',
            actionRowLabel: 'Go to',
            label: 'Go to window',
            icon: 'check',
            onSelect: vi.fn(),
          },
          {
            key: 'whole',
            actionRowLabel: 'Ir a la ventana',
            label: 'Ir a la ventana',
            icon: 'check',
            onSelect: vi.fn(),
          },
        ]}
      />
    );
    const short = screen.getByRole('menuitem', { name: 'Go to' });
    expect(short).toHaveAttribute('data-tooltip', 'Go to window');
    expect(short).toHaveAttribute('aria-description', 'Go to window');
    const whole = screen.getByRole('menuitem', { name: 'Ir a la ventana' });
    expect(whole).not.toHaveAttribute('data-tooltip');
    expect(whole).not.toHaveAttribute('aria-description');
  });
});
