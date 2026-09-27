import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Button from '../../components/common/Button';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-280 O7c. A handler that must ignore a double-click's second click
// reads the click count off the event, so Button hands the event on.
describe('Button onClick', () => {
  test('receives the click event, with its click count', async () => {
    const spy = vi.fn((event: React.MouseEvent<HTMLButtonElement>) => {
      void event;
    });
    await renderWithProviders(<Button text="x" onClick={spy} />);

    await userEvent.dblClick(screen.getByRole('button', { name: 'x' }));

    expect(spy.mock.calls.map(([event]) => event.detail)).toEqual([1, 2]);
  });

  test('is not called while ariaDisabled', async () => {
    const spy = vi.fn();
    await renderWithProviders(
      <Button text="x" onClick={spy} ariaDisabled={true} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'x' }));

    expect(spy).not.toHaveBeenCalled();
  });
});
