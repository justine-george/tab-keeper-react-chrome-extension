import { renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { popPressedCheck } from '../../components/settings/rightpane/pickMotion';
import { useCheckPop } from '../../components/settings/rightpane/useCheckPop';

// KAN-1031. A cell grid's check pops in when the pick changes, never on the
// grid's first paint, even when the grid is there from the start.

vi.mock('../../components/settings/rightpane/pickMotion', () => ({
  popPressedCheck: vi.fn(),
}));

afterEach(() => vi.mocked(popPressedCheck).mockClear());

describe('useCheckPop', () => {
  test('the first paint pops nothing, though the cells are there', () => {
    const cells = { current: document.createElement('div') };
    renderHook(() => useCheckPop(cells, 'en'));
    expect(popPressedCheck).not.toHaveBeenCalled();
  });

  test('a new pick pops the check in its cells, once per pick', () => {
    const cells = { current: document.createElement('div') };
    const { rerender } = renderHook(
      ({ picked }) => useCheckPop(cells, picked),
      {
        initialProps: { picked: 'en' },
      }
    );
    rerender({ picked: 'de' });
    expect(popPressedCheck).toHaveBeenCalledTimes(1);
    expect(popPressedCheck).toHaveBeenCalledWith(cells.current);
    // A render with the same pick pops nothing more.
    rerender({ picked: 'de' });
    expect(popPressedCheck).toHaveBeenCalledTimes(1);
  });

  test('StrictMode running the effect twice pops nothing on the first paint', () => {
    const cells = { current: document.createElement('div') };
    const { rerender } = renderHook(
      ({ picked }) => useCheckPop(cells, picked),
      {
        initialProps: { picked: 'en' },
        wrapper: StrictMode,
      }
    );
    expect(popPressedCheck).not.toHaveBeenCalled();
    rerender({ picked: 'de' });
    expect(popPressedCheck).toHaveBeenCalledTimes(1);
  });
});
