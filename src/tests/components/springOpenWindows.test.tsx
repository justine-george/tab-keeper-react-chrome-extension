import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, screen } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  expandWindow,
  setAllWindowsCollapsed,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import {
  foldBackSpringOpened,
  springOpenWindow,
  subscribeSpringOpenWindows,
  useSpringOpenWindows,
} from '../../redux/springOpenWindows';
import { makeTestStore } from '../setup/makeStore';

// KAN-379. A window the drag opened is drawn open while the overlay holds it;
// the stored fold is never written mid-drag.

const buildWindow = (n: number, tabTitles: string[]) => ({
  windowId: `win-${n}`,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabTitles.length,
  title: `Window ${n}`,
  tabs: tabTitles.map((title, i) => ({
    tabId: `w${n}-t${i}`,
    favicon: '',
    title,
    url: `https://example.com/w${n}/t${i}`,
  })),
});

const buildGroup = (n: number, windows: ReturnType<typeof buildWindow>[]) => ({
  tabGroupId: `group-${n}`,
  title: `Session ${n}`,
  createdTime: `2026-09-01 09:0${n}:00`,
  createdAt: Date.UTC(2026, 8, 1, 9, n, 0),
  windowCount: windows.length,
  tabCount: windows.reduce((sum, w) => sum + w.tabs.length, 0),
  isAutoSave: false,
  isSelected: false,
  windows,
});

const seedFolded = (s: ReturnType<typeof makeTestStore>['store']) => {
  s.dispatch(
    saveToTabContainerInternal(
      buildGroup(1, [
        buildWindow(1, ['Alpha Page']),
        buildWindow(2, ['Bravo Page']),
      ])
    )
  );
  s.dispatch(selectTabContainer('group-1'));
  s.dispatch(
    setAllWindowsCollapsed({
      tabGroupId: 'group-1',
      windowIds: ['win-1', 'win-2'],
    })
  );
  s.dispatch(setIsNotDirty());
};

const block = (id: string) =>
  document.querySelector(`[data-drop-window-id="${id}"]`);

afterEach(() => {
  foldBackSpringOpened();
});

describe('a window drawn open by the overlay (KAN-379)', () => {
  test('draws its rows while the overlay holds it, and stops after the fold back', async () => {
    await renderWithProviders(<TabGroupDetailsContainer />, {
      seedStore: seedFolded,
    });
    expect(screen.queryByText('Alpha Page')).toBeNull();

    act(() => springOpenWindow('win-1'));
    expect(screen.getByText('Alpha Page')).toBeTruthy();
    expect(screen.queryByText('Bravo Page')).toBeNull();

    act(() => foldBackSpringOpened());
    expect(screen.queryByText('Alpha Page')).toBeNull();
  });

  test('its chevron is named Collapse while the overlay holds it', async () => {
    await renderWithProviders(<TabGroupDetailsContainer />, {
      seedStore: seedFolded,
    });
    expect(screen.queryAllByLabelText(/^Collapse(: |$)/).length).toBe(0);

    act(() => springOpenWindow('win-1'));
    expect(screen.queryAllByLabelText(/^Collapse(: |$)/).length).toBe(1);
    expect(screen.queryAllByLabelText(/^Expand(: |$)/).length).toBe(1);
  });

  test('data-window-collapsed follows what is drawn, and never marks the trailing block', async () => {
    await renderWithProviders(<TabGroupDetailsContainer />, {
      seedStore: seedFolded,
    });
    expect(block('win-1')?.hasAttribute('data-window-collapsed')).toBe(true);
    expect(block('win-2')?.hasAttribute('data-window-collapsed')).toBe(true);

    act(() => springOpenWindow('win-1'));
    expect(block('win-1')?.hasAttribute('data-window-collapsed')).toBe(false);
    expect(block('win-2')?.hasAttribute('data-window-collapsed')).toBe(true);

    act(() => foldBackSpringOpened());
    expect(block('win-1')?.hasAttribute('data-window-collapsed')).toBe(true);

    const trailing = document.querySelectorAll('[data-new-window-target]');
    for (const el of trailing) {
      expect(el.hasAttribute('data-window-collapsed')).toBe(false);
    }
  });

  test('a window open in the store carries no data-window-collapsed', async () => {
    await renderWithProviders(<TabGroupDetailsContainer />, {
      seedStore: (s) => {
        seedFolded(s);
        s.dispatch(
          setAllWindowsCollapsed({ tabGroupId: 'group-1', windowIds: [] })
        );
      },
    });
    expect(block('win-1')?.hasAttribute('data-window-collapsed')).toBe(false);
  });
});

describe('expandWindow (KAN-379)', () => {
  const folded = () => {
    const { store } = makeTestStore();
    store.dispatch(
      setAllWindowsCollapsed({
        tabGroupId: 'group-1',
        windowIds: ['win-1', 'win-2'],
      })
    );
    return store;
  };

  test('is a no-op for another session, and for no set at all', () => {
    const store = folded();
    store.dispatch(expandWindow({ tabGroupId: 'group-2', windowId: 'win-1' }));
    expect(store.getState().globalState.collapsedWindows).toEqual({
      tabGroupId: 'group-1',
      windowIds: ['win-1', 'win-2'],
    });

    const { store: bare } = makeTestStore();
    bare.dispatch(expandWindow({ tabGroupId: 'group-1', windowId: 'win-1' }));
    expect(bare.getState().globalState.collapsedWindows).toBeNull();
  });

  test('twice equals once', () => {
    const store = folded();
    const action = expandWindow({ tabGroupId: 'group-1', windowId: 'win-1' });
    store.dispatch(action);
    store.dispatch(action);
    expect(store.getState().globalState.collapsedWindows).toEqual({
      tabGroupId: 'group-1',
      windowIds: ['win-2'],
    });
  });

  test('neither dirties the session nor enters undo history', async () => {
    const { store } = await renderWithProviders(<TabGroupDetailsContainer />, {
      seedStore: seedFolded,
    });
    const dataBefore = store.getState().tabContainerDataState;
    const undoDepthBefore = store.getState().undoRedo.past.length;

    act(() => {
      store.dispatch(
        expandWindow({ tabGroupId: 'group-1', windowId: 'win-1' })
      );
    });

    expect(store.getState().globalState.collapsedWindows?.windowIds).toEqual([
      'win-2',
    ]);
    expect(store.getState().tabContainerDataState).toBe(dataBefore);
    expect(store.getState().globalState.isDirty).toBe(false);
    expect(store.getState().undoRedo.past.length).toBe(undoDepthBefore);
  });
});

describe('the overlay as a store (KAN-379)', () => {
  test('useSpringOpenWindows is a new set after each change, the same set between them', () => {
    const { result } = renderHook(() => useSpringOpenWindows());
    const empty = result.current;

    act(() => springOpenWindow('win-1'));
    const one = result.current;
    expect(one).not.toBe(empty);
    expect([...one]).toEqual(['win-1']);

    act(() => springOpenWindow('win-1'));
    expect(result.current).toBe(one);

    act(() => springOpenWindow('win-2'));
    expect(result.current).not.toBe(one);

    const two = result.current;
    act(() => foldBackSpringOpened());
    expect(result.current).not.toBe(two);
    expect(result.current.size).toBe(0);
  });

  test('foldBackSpringOpened on an empty overlay does not notify, and says nothing folded back', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSpringOpenWindows(listener);
    expect(foldBackSpringOpened()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    springOpenWindow('win-1');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(foldBackSpringOpened()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
