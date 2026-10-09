import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';

import { makeTestStore } from '../setup/makeStore';
import { useKeepWindowOpen } from '../../components/home/rightpane/useKeepWindowOpen';
import { setAllWindowsCollapsed } from '../../redux/slices/globalStateSlice';

// KAN-379 Q3 A. The window a drag opened and dropped into is kept open in the
// stored fold; nothing else about the fold changes.
describe('useKeepWindowOpen', () => {
  function setup(tabGroupId: string) {
    const { store } = makeTestStore();
    store.dispatch(
      setAllWindowsCollapsed({ tabGroupId: 's1', windowIds: ['w1', 'w2'] })
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result, rerender } = renderHook(
      () => useKeepWindowOpen(tabGroupId),
      { wrapper }
    );
    return { store, result, rerender };
  }

  test('opens that window in the stored fold, and leaves the others folded', () => {
    const { store, result } = setup('s1');
    act(() => result.current('w2'));
    expect(store.getState().globalState.collapsedWindows).toEqual({
      tabGroupId: 's1',
      windowIds: ['w1'],
    });
  });

  // The engine re-binds its listeners when a prop changes identity.
  test('keeps its identity across renders', () => {
    const { result, rerender } = setup('s1');
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
