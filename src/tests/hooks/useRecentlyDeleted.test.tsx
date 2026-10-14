import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';

import { useRecentlyDeleted } from '../../hooks/useRecentlyDeleted';
import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import {
  RECENTLY_DELETED_KEY,
  withDeleted,
} from '../../utils/functions/recentlyDeleted';

// KAN-595. What the Recently deleted page lists: stored entries whose session
// is not live, kept current as either side changes.

const s = (id: string) => buildSession({ tabGroupId: id, title: id });

let handle: ReturnType<typeof setupChromeFake> | undefined;

beforeEach(() => {
  localStorage.clear();
  handle = setupChromeFake();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  handle?.restore();
  handle = undefined;
});

const mount = (liveIds: string[]) => {
  const { store } = makeTestStore();
  store.dispatch(replaceState(buildContainer(liveIds.map(s))));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(() => useRecentlyDeleted(), { wrapper });
  const shownIds = () =>
    hook.result.current.shown.map((e) => e.session.tabGroupId);
  return { store, hook, shownIds };
};

const seed = async (ids: string[], at = Date.now()) =>
  chrome.storage.local.set({
    [RECENTLY_DELETED_KEY]: withDeleted([], ids.map(s), at),
  });

describe('useRecentlyDeleted', () => {
  it('lists stored sessions that are not live', async () => {
    await seed(['A', 'B']);
    const { shownIds } = mount(['B', 'C']);
    await waitFor(() => expect(shownIds()).toEqual(['A']));
  });

  it('follows a delete made in another page, without a remount', async () => {
    await seed(['A'], Date.now() - 1000);
    const { shownIds } = mount([]);
    await waitFor(() => expect(shownIds()).toEqual(['A']));
    const stored = (await chrome.storage.local.get(RECENTLY_DELETED_KEY))[
      RECENTLY_DELETED_KEY
    ];
    await act(async () => {
      await chrome.storage.local.set({
        [RECENTLY_DELETED_KEY]: withDeleted(
          stored as Parameters<typeof withDeleted>[0],
          [s('C')],
          Date.now()
        ),
      });
    });
    await waitFor(() => expect(shownIds()).toEqual(['C', 'A']));
  });

  it('hides a session once it is live again, and shows it once it is gone again', async () => {
    await seed(['A']);
    const { store, shownIds } = mount([]);
    await waitFor(() => expect(shownIds()).toEqual(['A']));
    act(() => {
      store.dispatch(replaceState(buildContainer([s('A')])));
    });
    expect(shownIds()).toEqual([]);
    act(() => {
      store.dispatch(replaceState(buildContainer([])));
    });
    expect(shownIds()).toEqual(['A']);
  });

  it('empty clears the stored list', async () => {
    await seed(['A', 'B']);
    const { hook, shownIds } = mount([]);
    // Deleted in the same instant: the list keeps their order.
    await waitFor(() => expect(shownIds()).toEqual(['A', 'B']));
    await act(async () => {
      await hook.result.current.empty();
    });
    await waitFor(() => expect(shownIds()).toEqual([]));
    expect(RECENTLY_DELETED_KEY in (handle?.localArea() ?? {})).toBe(false);
  });

  it('stops listening when unmounted', async () => {
    const add = vi.spyOn(chrome.storage.local.onChanged, 'addListener');
    const remove = vi.spyOn(chrome.storage.local.onChanged, 'removeListener');
    const { hook } = mount([]);
    expect(add).toHaveBeenCalledTimes(1);
    hook.unmount();
    expect(remove).toHaveBeenCalledWith(add.mock.calls[0][0]);
  });
});
