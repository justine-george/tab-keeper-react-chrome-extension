import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import {
  CHROME_SHORTCUTS_URL,
  openShortcutsBeside,
  usePopupShortcut,
} from '../../hooks/usePopupShortcut';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../setup/chrome.fake';

// KAN-423. The shortcuts page opens beside this tab, and the key is read again on return.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  cleanup();
  handle?.restore();
  handle = undefined;
});

const bound = (shortcut: string): chrome.commands.Command[] => [
  { name: '_execute_action', shortcut, description: '' },
];

describe('openShortcutsBeside', () => {
  const fullView: ChromeSeed = {
    windows: [
      { id: 7, tabs: [{ id: 70 }, { id: 71 }, { id: 72 }, { id: 73 }] },
    ],
    currentTabId: 71,
  };

  test('in a tab: opens right after it, as its child, in its window', async () => {
    handle = setupChromeFake(fullView);
    await openShortcutsBeside();
    expect(handle.createdTabs).toEqual([
      {
        url: CHROME_SHORTCUTS_URL,
        index: 2,
        openerTabId: 71,
        windowId: 7,
      },
    ]);
  });

  test('in the popup, where there is no current tab: the plain url', async () => {
    handle = setupChromeFake({ windows: [{ id: 7, tabs: [{ id: 70 }] }] });
    await openShortcutsBeside();
    expect(handle.createdTabs).toEqual([{ url: CHROME_SHORTCUTS_URL }]);
  });

  test('a current tab with no id falls back to the plain url', async () => {
    handle = setupChromeFake(fullView);
    const current = await chrome.tabs.getCurrent();
    Object.defineProperty(chrome.tabs, 'getCurrent', {
      configurable: true,
      value: () => Promise.resolve({ ...current, id: undefined }),
    });
    await openShortcutsBeside();
    expect(handle.createdTabs).toEqual([{ url: CHROME_SHORTCUTS_URL }]);
  });

  test('a getCurrent that rejects falls back to the plain url', async () => {
    handle = setupChromeFake(fullView);
    Object.defineProperty(chrome.tabs, 'getCurrent', {
      configurable: true,
      value: () => Promise.reject(new Error('gone')),
    });
    await openShortcutsBeside();
    expect(handle.createdTabs).toEqual([{ url: CHROME_SHORTCUTS_URL }]);
  });
});

describe('usePopupShortcut reads again on return', () => {
  // The fake reads seed.commands per call, so the test rebinds the key like Chrome's page would.
  const setup = (first: string) => {
    const seed: ChromeSeed = { commands: bound(first) };
    handle = setupChromeFake(seed);
    return {
      rebind: (next: string) => {
        seed.commands = bound(next);
      },
    };
  };
  const show = (state: DocumentVisibilityState) =>
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
  afterEach(() => show('visible'));

  test('undefined until the first answer, then the bound key', async () => {
    setup('Alt+Shift+K');
    const { result } = renderHook(() => usePopupShortcut());
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe('Alt+Shift+K'));
  });

  test('a visibilitychange to visible shows the new key', async () => {
    const { rebind } = setup('Alt+Shift+K');
    const { result } = renderHook(() => usePopupShortcut());
    await waitFor(() => expect(result.current).toBe('Alt+Shift+K'));
    rebind('Alt+Shift+J');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current).toBe('Alt+Shift+J'));
  });

  test('a visibilitychange to hidden reads nothing', async () => {
    const { rebind } = setup('Alt+Shift+K');
    const { result } = renderHook(() => usePopupShortcut());
    await waitFor(() => expect(result.current).toBe('Alt+Shift+K'));
    rebind('Alt+Shift+J');
    show('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {});
    expect(result.current).toBe('Alt+Shift+K');
  });

  test('a window focus shows the new key', async () => {
    const { rebind } = setup('Alt+Shift+K');
    const { result } = renderHook(() => usePopupShortcut());
    await waitFor(() => expect(result.current).toBe('Alt+Shift+K'));
    rebind('');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(result.current).toBe(''));
  });

  test('after unmount neither event reads again', async () => {
    const { rebind } = setup('Alt+Shift+K');
    const { result, unmount } = renderHook(() => usePopupShortcut());
    await waitFor(() => expect(result.current).toBe('Alt+Shift+K'));
    unmount();
    let reads = 0;
    const getAll = chrome.commands.getAll;
    Object.defineProperty(chrome.commands, 'getAll', {
      configurable: true,
      value: () => {
        reads += 1;
        return getAll();
      },
    });
    rebind('Alt+Shift+J');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(reads).toBe(0);
  });

  test('an older read that settles late does not overwrite a newer one', async () => {
    setup('Alt+Shift+K');
    const { result } = renderHook(() => usePopupShortcut());
    await waitFor(() => expect(result.current).toBe('Alt+Shift+K'));
    const answers: ((c: chrome.commands.Command[]) => void)[] = [];
    Object.defineProperty(chrome.commands, 'getAll', {
      configurable: true,
      value: () =>
        new Promise<chrome.commands.Command[]>((resolve) =>
          answers.push(resolve)
        ),
    });
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      answers[1](bound('Alt+Shift+J'));
      answers[0](bound('Alt+Shift+L'));
    });
    expect(result.current).toBe('Alt+Shift+J');
  });
});
