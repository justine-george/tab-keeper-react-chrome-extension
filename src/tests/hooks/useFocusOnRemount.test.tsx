import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { useFocusOnRemount } from '../../hooks/useFocusOnRemount';

// KAN-389. A field swapped for a title button, as a rename does. fireEvent moves no focus, so only the hook can.
function Swap({ askKey, then }: { askKey: string; then: 'title' | 'nothing' }) {
  const focus = useFocusOnRemount();
  const [shown, setShown] = useState<'field' | 'title' | 'nothing'>('field');
  return (
    <>
      <button
        type="button"
        onClick={() => {
          focus.ask(askKey);
          setShown(then);
        }}
      >
        Commit
      </button>
      <button type="button" onClick={() => setShown('title')}>
        Show title
      </button>
      {shown === 'field' && <input aria-label="Field" />}
      {shown === 'title' && (
        <button type="button" ref={focus.refFor('title')}>
          Title
        </button>
      )}
    </>
  );
}

const press = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

describe('useFocusOnRemount', () => {
  test('the asked control takes focus when it mounts', () => {
    render(<Swap askKey="title" then="title" />);
    press('Commit');

    expect(document.activeElement).toBe(screen.getByText('Title'));
  });

  test('a control under another key takes nothing', () => {
    render(<Swap askKey="other" then="title" />);
    press('Commit');

    expect(document.activeElement).toBe(document.body);
  });

  test('an ask the next commit leaves unclaimed is gone when the control mounts later', () => {
    render(<Swap askKey="title" then="nothing" />);
    press('Commit');
    press('Show title');

    expect(document.activeElement).toBe(document.body);
  });
});
