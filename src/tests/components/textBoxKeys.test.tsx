import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import TextBox from '../../components/common/TextBox';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-678, KAN-679. The session name field. Chrome closes the popup on any
// Esc the page leaves alone (KAN-403), and Enter saved without letting go of
// the field, where a click on + leaves it.

function Held({ onKeyEnter }: { onKeyEnter?: () => void }) {
  const [value, setValue] = useState('');
  return (
    <TextBox
      id="name"
      name="name"
      value={value}
      placeholder="Name the new session"
      onChange={(e) => setValue(e.target.value)}
      onKeyEnter={onKeyEnter}
    />
  );
}

const field = () => screen.getByPlaceholderText('Name the new session');

const press = (key: string, init: { isComposing?: boolean } = {}) => {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(field(), { key, ...init });
  });
  return notPrevented;
};

describe('Esc in the name field (KAN-678)', () => {
  test('is consumed, leaves the field, and keeps the name', async () => {
    await renderWithProviders(<Held onKeyEnter={() => {}} />);
    act(() => {
      fireEvent.change(field(), { target: { value: 'Kyoto' } });
      field().focus();
    });

    expect(press('Escape')).toBe(false);
    expect(field()).not.toHaveFocus();
    expect(field()).toHaveValue('Kyoto');
  });

  test('while composing, stays the IME’s', async () => {
    await renderWithProviders(<Held onKeyEnter={() => {}} />);
    act(() => field().focus());

    expect(press('Escape', { isComposing: true })).toBe(true);
    expect(field()).toHaveFocus();
  });
});

describe('Enter in the name field (KAN-679)', () => {
  test('saves, then leaves the field', async () => {
    const onKeyEnter = vi.fn();
    await renderWithProviders(<Held onKeyEnter={onKeyEnter} />);
    act(() => field().focus());

    press('Enter');

    expect(onKeyEnter).toHaveBeenCalledTimes(1);
    expect(field()).not.toHaveFocus();
  });

  // While searching the row has no save, and Enter is not this field's.
  test('without a save, keeps the field', async () => {
    await renderWithProviders(<Held />);
    act(() => field().focus());

    press('Enter');

    expect(field()).toHaveFocus();
  });

  test('another key keeps the field', async () => {
    const onKeyEnter = vi.fn();
    await renderWithProviders(<Held onKeyEnter={onKeyEnter} />);
    act(() => field().focus());

    expect(press('a')).toBe(true);
    expect(onKeyEnter).not.toHaveBeenCalled();
    expect(field()).toHaveFocus();
  });
});
