import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import Icon from '../../components/common/Icon';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-345. Chrome reads a title it did not use for the name as the
// description, so a tooltip equal to the name was announced twice.
describe('an Icon is not described by its own name', () => {
  const noop = () => {};

  test('a tooltip equal to the name: an empty description', async () => {
    await renderWithProviders(
      <Icon type="undo" onClick={noop} ariaLabel="Undo" tooltipText="Undo" />
    );
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button).toHaveAttribute('title', 'Undo');
    expect(button).toHaveAttribute('aria-description', '');
  });

  test('a tooltip that adds something stays the description', async () => {
    await renderWithProviders(
      <Icon
        type="reopen_window"
        onClick={noop}
        ariaLabel="Open"
        tooltipText="Open session"
      />
    );
    expect(screen.getByRole('button', { name: 'Open' })).not.toHaveAttribute(
      'aria-description'
    );
  });

  test('an explicit description wins', async () => {
    await renderWithProviders(
      <Icon
        type="sync"
        onClick={noop}
        ariaLabel="Sync now"
        tooltipText="Sync now"
        ariaDescription="Sync is off"
      />
    );
    expect(screen.getByRole('button', { name: 'Sync now' })).toHaveAttribute(
      'aria-description',
      'Sync is off'
    );
  });

  test('a decoration carries none', async () => {
    const { container } = await renderWithProviders(<Icon type="web_asset" />);
    expect(container.querySelector('[aria-description]')).toBeNull();
  });
});
