import { createRef, useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import SearchRow from '../../components/common/SearchRow';
import { renderWithProviders } from '../setup/renderWithProviders';

type Props = Partial<Parameters<typeof SearchRow>[0]>;

function Held(props: Props) {
  const [text, setText] = useState('');
  const [inputRef] = useState(() => createRef<HTMLInputElement>());
  return (
    <SearchRow
      text={text}
      onTextChange={setText}
      inputRef={inputRef}
      label="Search things"
      glassInset="32px"
      glassBox="column"
      textInset="8px"
      rowAttribute="data-saved-search"
      {...props}
    />
  );
}

const field = () => screen.getByRole('textbox', { name: 'Search things' });
const glyph = () => {
  const el = document.querySelector(
    '[data-saved-search] span.material-symbols-outlined'
  );
  if (!(el instanceof HTMLElement)) throw new Error('no magnifier drawn');
  return el;
};

describe('SearchRow', () => {
  test('label is the placeholder and the accessible name', async () => {
    await renderWithProviders(<Held label="Search things" />);
    expect(field()).toHaveAttribute('placeholder', 'Search things');
  });

  test('rowAttribute marks the row', async () => {
    await renderWithProviders(<Held rowAttribute="data-open-now-search" />);
    expect(document.querySelector('[data-open-now-search]')).not.toBeNull();
    expect(document.querySelector('[data-saved-search]')).toBeNull();
  });

  test('ArrowDown and Enter call their handlers when given', async () => {
    const onArrowDown = vi.fn();
    const onEnter = vi.fn();
    await renderWithProviders(
      <Held onArrowDown={onArrowDown} onEnter={onEnter} />
    );
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onArrowDown).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  test('without handlers, ArrowDown and Enter are inert', async () => {
    await renderWithProviders(<Held />);
    // React reports a throw in a handler on window, not out of fireEvent.
    const thrown: unknown[] = [];
    const record = (event: ErrorEvent) => {
      event.preventDefault();
      thrown.push(event.error);
    };
    window.addEventListener('error', record);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    window.removeEventListener('error', record);
    expect(thrown).toEqual([]);
  });

  test('without an onArrowDown, ArrowDown keeps its default', async () => {
    await renderWithProviders(<Held />);
    // fireEvent returns false when the event was preventDefault-ed.
    expect(fireEvent.keyDown(field(), { key: 'ArrowDown' })).toBe(true);
  });

  test("glassBox 'column' draws a 20px glyph in the 24px icon's box (4px + 2px)", async () => {
    await renderWithProviders(<Held glassBox="column" />);
    expect(glyph()).toHaveStyle({ fontSize: '20px' });
    expect(glyph().closest('[aria-hidden="true"]')).toHaveStyle({
      padding: '6px',
    });
  });

  test("glassBox 'tight' draws a 20px glyph with no padding", async () => {
    await renderWithProviders(<Held glassBox="tight" />);
    expect(glyph()).toHaveStyle({ fontSize: '20px' });
    expect(glyph().closest('[aria-hidden="true"]')).toHaveStyle({
      padding: '0',
    });
  });

  test('glassInset and textInset place the glass and the text', async () => {
    await renderWithProviders(<Held glassInset="40px" textInset="12px" />);
    expect(glyph().closest('[data-saved-search] > span')).toHaveStyle({
      marginLeft: '40px',
    });
    expect(field()).toHaveStyle({ paddingLeft: '12px' });
  });
});
