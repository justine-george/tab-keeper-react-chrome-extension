import { createRef, useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OpenNowSearchRow from '../../components/home/opennow/OpenNowSearchRow';
import { renderWithProviders } from '../setup/renderWithProviders';

// The row with its text held, as OpenNowColumn holds it.
function Held({
  onArrowDown = () => {},
  onEnter = () => {},
  onOuterKey = () => {},
}: {
  onArrowDown?: () => void;
  onEnter?: () => void;
  onOuterKey?: (key: string) => void;
}) {
  const [text, setText] = useState('');
  const [inputRef] = useState(() => createRef<HTMLInputElement>());
  return (
    <div onKeyDown={(e) => onOuterKey(e.key)}>
      <OpenNowSearchRow
        text={text}
        onTextChange={setText}
        inputRef={inputRef}
        onArrowDown={onArrowDown}
        onEnter={onEnter}
      />
    </div>
  );
}

const field = () => screen.getByRole('textbox', { name: 'Search open tabs' });

describe('the Open now search row (KAN-330 O14, O14d C1)', () => {
  test('a field named and labelled "Search open tabs", with the / hint while empty', async () => {
    await renderWithProviders(<Held />);
    expect(field()).toHaveAttribute('placeholder', 'Search open tabs');
    expect(field()).toHaveAttribute('aria-keyshortcuts', '/');
    expect(screen.getByText('/')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  test('with text, the clear × replaces the hint, and clears back into the field', async () => {
    await renderWithProviders(<Held />);
    const user = userEvent.setup();
    await user.type(field(), 'kyoto');
    expect(screen.queryByText('/')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(field()).toHaveValue('');
    expect(document.activeElement).toBe(field());
  });

  test('Esc with text clears it, keeps focus, and stops the key', async () => {
    const onOuterKey = vi.fn();
    await renderWithProviders(<Held onOuterKey={onOuterKey} />);
    const user = userEvent.setup();
    await user.type(field(), 'kyoto');
    onOuterKey.mockClear();
    await user.keyboard('{Escape}');
    expect(field()).toHaveValue('');
    expect(document.activeElement).toBe(field());
    expect(onOuterKey).not.toHaveBeenCalledWith('Escape');
  });

  test('Esc in an empty field lets the key through', async () => {
    const onOuterKey = vi.fn();
    await renderWithProviders(<Held onOuterKey={onOuterKey} />);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onOuterKey).toHaveBeenCalledWith('Escape');
  });

  test('↓ and Enter are reported, and ↓ does not move the caret', async () => {
    const onArrowDown = vi.fn();
    const onEnter = vi.fn();
    await renderWithProviders(
      <Held onArrowDown={onArrowDown} onEnter={onEnter} />
    );
    const down = fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onArrowDown).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(down).toBe(false); // preventDefault was called
  });
});
