import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, test } from 'vitest';

import { useSessionListSettled } from '../../hooks/useSessionListSettled';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { makeTestStore } from '../setup/makeStore';

afterEach(() => localStorage.clear());

function mount() {
  const { store } = makeTestStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, ...renderHook(() => useSessionListSettled(), { wrapper }) };
}

describe('useSessionListSettled', () => {
  test('nothing on disk: settled at once', () => {
    expect(mount().result.current).toBe(true);
  });

  test('sessions on disk: not settled until the list loads (CONTROL: then it is)', () => {
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([buildSession()]))
    );
    const { store, result } = mount();
    expect(result.current).toBe(false);
    act(() => {
      store.dispatch(replaceState(buildContainer([buildSession()])));
    });
    expect(result.current).toBe(true);
  });
});
