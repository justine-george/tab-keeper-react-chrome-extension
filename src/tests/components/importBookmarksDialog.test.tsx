import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useSelector } from 'react-redux';

vi.mock('../../redux/bookmarkImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../redux/bookmarkImport')>()),
  importSizeRefusal: vi.fn(async () => null),
}));

import { ImportBookmarksDialog } from '../../components/modals/ImportBookmarksDialog';
import { renderWithProviders } from '../setup/renderWithProviders';
import { startBookmarkImport } from '../../redux/startBookmarkImport';
import { importSizeRefusal } from '../../redux/bookmarkImport';
import type { RootState } from '../../redux/store';
import { toastTexts } from '../setup/toasts';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-862. The import dialog: a folder tree to tick, a preview of the sessions it makes.

type Node = chrome.bookmarks.BookmarkTreeNode;
type GetTree = () => Promise<Node[]>;

const link = (id: string): Node => ({
  id,
  title: `Page ${id}`,
  url: `https://example.test/${id}`,
  syncing: false,
});
const links = (prefix: string, n: number): Node[] =>
  Array.from({ length: n }, (_, i) => link(`${prefix}${i}`));
const folder = (
  id: string,
  title: string,
  children: Node[],
  extra: Partial<Node> = {}
): Node => ({ id, title, children, syncing: false, ...extra });

// Mock r3's library: Kitchen remodel makes 3 windows and 14 tabs.
const library = (
  opts: { kitchenOwn?: number; withWork?: boolean } = {}
): Node[] => [
  folder('0', '', [
    folder(
      'bar',
      'Bookmarks Bar',
      [
        ...links('b', 3),
        folder('kitchen', 'Kitchen remodel', [
          ...links('k', opts.kitchenOwn ?? 3),
          folder('tiles', 'Tiles', links('t', 5)),
          folder('appl', 'Appliances', [
            ...links('a', 4),
            folder('fridges', 'Fridges', links('f', 2)),
          ]),
        ]),
        folder('recipes', 'Recipes', [
          ...links('r', 15),
          folder('soups', 'Soups', links('s', 8)),
        ]),
        ...(opts.withWork === false
          ? []
          : [folder('work', 'Work', links('w', 9))]),
        folder('old', 'Old stuff', []),
      ],
      { folderType: 'bookmarks-bar' }
    ),
    folder(
      'other',
      'Other Bookmarks',
      [folder('reading', 'Reading list', links('rl', 30))],
      { folderType: 'other' }
    ),
  ]),
];

// The dialog mounts while the flag is set, as MainContainer mounts it.
const Host = () => {
  const open = useSelector(
    (s: RootState) => s.globalState.isImportBookmarksOpen
  );
  return open ? <ImportBookmarksDialog /> : null;
};

const getTree = vi.fn<GetTree>();
let remove: ReturnType<typeof vi.spyOn>;

const openDialog = async (
  seed: Parameters<typeof renderWithProviders>[1] = {}
) => {
  const result = await renderWithProviders(<Host />, seed);
  Object.assign(globalThis.chrome, { bookmarks: { getTree } });
  remove = vi.spyOn(globalThis.chrome.permissions, 'remove');
  await act(async () => {
    await result.store.dispatch(startBookmarkImport());
  });
  return result;
};

const dialog = () =>
  screen.getByRole('dialog', { name: 'Import from bookmarks' });
const box = (name: string) => screen.getByRole('checkbox', { name });
const importButton = () =>
  within(dialog()).getByRole('button', { name: /^Import/ });
const unfold = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Expand: ${name}` }));
const tick = (name: string) => fireEvent.click(box(name));
const preview = () => screen.getByRole('region', { name: 'Preview' });
const sessionTitles = (state: RootState) =>
  state.tabContainerDataState.tabGroups.map((g) => g.title);

beforeEach(() => {
  history.replaceState(null, '', '?view=tab');
  getTree.mockReset();
  getTree.mockResolvedValue(library());
  vi.mocked(importSizeRefusal).mockReset();
  vi.mocked(importSizeRefusal).mockResolvedValue(null);
});
afterEach(() => {
  history.replaceState(null, '', '?');
  vi.useRealTimers();
});

describe('the import dialog: layout', () => {
  test('only the first Bookmarks Bar starts unfolded', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    const names = screen
      .getAllByRole('checkbox')
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Bookmarks Bar',
      'Kitchen remodel',
      'Recipes',
      'Work',
      'Old stuff',
      'Other Bookmarks',
    ]);
  });

  test('an empty folder cannot be ticked', async () => {
    await openDialog();
    expect(
      await screen.findByRole('checkbox', { name: 'Old stuff' })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog()).getByText('0 Bookmarks')).toBeInTheDocument();
  });

  test('nothing ticked: Import reads "Import", is dimmed, and the preview says what shows there', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    expect(importButton()).toHaveTextContent(/^Import$/);
    expect(importButton()).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(preview()).getByText('The sessions your import makes show here.')
    ).toBeInTheDocument();
  });

  test('below 720px wide the panes stack, the tree first', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    const panes = dialog().querySelector('[data-import-panes]');
    expect(panes).not.toBeNull();
    const cls = [...(panes?.classList ?? [])].find((c) => c.startsWith('css-'));
    const rules = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n');
    expect(rules).toMatch(
      new RegExp(`\\.${cls}\\{[^}]*grid-template-columns:1\\.15fr 1fr;`)
    );
    expect(rules).toMatch(
      new RegExp(
        `@media \\(max-width: 719\\.98px\\)\\{\\.${cls}\\{grid-template-columns:1fr;`
      )
    );
    const [tree, shown] = panes?.children ?? [];
    expect(tree).toContainElement(box('Work'));
    expect(shown).toBe(preview());
  });
});

describe('the import dialog: ticking', () => {
  test('a ticked folder covers its subfolders and previews its session', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    unfold('Kitchen remodel');
    unfold('Appliances');

    tick('Kitchen remodel');

    for (const name of ['Tiles', 'Appliances', 'Fridges']) {
      expect(box(name)).toHaveAttribute('aria-checked', 'true');
      expect(box(name)).toHaveAttribute('aria-disabled', 'true');
    }
    const shown = within(preview());
    expect(
      shown.getByText('Kitchen remodel', {
        selector: '[data-preview-session] > *',
      })
    ).toBeInTheDocument();
    expect(shown.getByText('3 Windows · 14 Tabs')).toBeInTheDocument();
    const windows = preview().querySelectorAll('[data-preview-window]');
    expect(
      [...windows].map((w) => [
        w.querySelector('[data-preview-window-name]')?.textContent,
        w.querySelector('[data-row-tag]')?.textContent,
      ])
    ).toEqual([
      ['Kitchen remodel', '3 Tabs'],
      ['Tiles', '5 Tabs'],
      ['Appliances', '6 Tabs'],
    ]);
    expect(importButton()).toHaveTextContent('Import 1 session');
    expect(importButton()).not.toHaveAttribute('aria-disabled');
  });

  test('unticking the parent frees what it covered', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    unfold('Kitchen remodel');
    tick('Kitchen remodel');
    tick('Kitchen remodel');
    expect(box('Tiles')).toHaveAttribute('aria-checked', 'false');
    expect(box('Tiles')).not.toHaveAttribute('aria-disabled');
  });

  test("ticking a parent takes back its subfolders' own ticks", async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    unfold('Kitchen remodel');
    tick('Tiles');
    tick('Kitchen remodel');
    tick('Kitchen remodel');
    expect(box('Tiles')).toHaveAttribute('aria-checked', 'false');
    expect(importButton()).toHaveTextContent(/^Import$/);
  });

  test('← folds and → unfolds the focused row', async () => {
    await openDialog();
    const kitchen = await screen.findByRole('checkbox', {
      name: 'Kitchen remodel',
    });
    fireEvent.keyDown(kitchen, { key: 'ArrowRight' });
    expect(box('Tiles')).toBeInTheDocument();
    fireEvent.keyDown(kitchen, { key: 'ArrowLeft' });
    expect(screen.queryByRole('checkbox', { name: 'Tiles' })).toBeNull();
  });
});

describe('the import dialog: importing', () => {
  test('Import builds the sessions from a fresh read, closes, and hands the permission back', async () => {
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    tick('Kitchen remodel');
    // The library changed while the dialog was open: one more link of its own.
    getTree.mockResolvedValue(library({ kitchenOwn: 4 }));

    await act(async () => {
      fireEvent.click(importButton());
    });

    await waitFor(() =>
      expect(store.getState().globalState.isImportBookmarksOpen).toBe(false)
    );
    expect(getTree).toHaveBeenCalledTimes(2);
    const [made] = store.getState().tabContainerDataState.tabGroups;
    expect(made.title).toBe('Kitchen remodel');
    expect(made.tabCount).toBe(15);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test('a ticked folder gone from the fresh read is skipped; the rest import', async () => {
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Kitchen remodel');
    tick('Work');
    expect(importButton()).toHaveTextContent('Import 2 sessions');
    getTree.mockResolvedValue(library({ withWork: false }));

    await act(async () => {
      fireEvent.click(importButton());
    });

    await waitFor(() =>
      expect(sessionTitles(store.getState())).toEqual(['Kitchen remodel'])
    );
    expect(store.getState().globalState.isImportBookmarksOpen).toBe(false);
  });

  test('every ticked folder gone from the fresh read: nothing imports, and the tree shows the library as it is', async () => {
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Work');
    getTree.mockResolvedValue(library({ withWork: false }));

    await act(async () => {
      fireEvent.click(importButton());
    });

    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'Work' })).toBeNull()
    );
    expect(store.getState().globalState.isImportBookmarksOpen).toBe(true);
    expect(sessionTitles(store.getState())).toEqual([]);
    expect(importButton()).toHaveAttribute('aria-disabled', 'true');
    expect(remove).not.toHaveBeenCalled();
  });

  test('a fresh read that fails closes the dialog with the unreadable toast', async () => {
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Work');
    getTree.mockRejectedValue(new Error('gone'));

    await act(async () => {
      fireEvent.click(importButton());
    });

    await waitFor(() =>
      expect(store.getState().globalState.isImportBookmarksOpen).toBe(false)
    );
    expect(sessionTitles(store.getState())).toEqual([]);
    expect(toastTexts(store.getState())).toContain(
      TOAST_MESSAGES.BOOKMARKS_UNREADABLE
    );
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('the import dialog: closing', () => {
  test('Esc while Import reads, then the read fails: no toast over the closed dialog, the permission goes back once', async () => {
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Work');
    let fail: (error: Error) => void = () => {};
    getTree.mockImplementation(
      () => new Promise<Node[]>((_, reject) => (fail = reject))
    );

    await act(async () => {
      fireEvent.click(importButton());
    });
    await act(async () => {
      fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    });
    await act(async () => {
      fail(new Error('gone'));
    });

    expect(toastTexts(store.getState())).toEqual([]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test('Esc while Import reads the library: nothing imports, and the permission goes back once', async () => {
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Work');
    let answer: (tree: Node[]) => void = () => {};
    getTree.mockImplementation(
      () => new Promise<Node[]>((resolve) => (answer = resolve))
    );

    await act(async () => {
      fireEvent.click(importButton());
    });
    await act(async () => {
      fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    });
    await act(async () => {
      answer(library());
    });

    expect(store.getState().globalState.isImportBookmarksOpen).toBe(false);
    expect(sessionTitles(store.getState())).toEqual([]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      'Cancel',
      () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })),
    ],
    ['✕', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    [
      'Esc',
      () => fireEvent(dialog(), new Event('cancel', { cancelable: true })),
    ],
  ])(
    '%s closes without importing and hands the permission back',
    async (_, close) => {
      const { store } = await openDialog();
      await screen.findByRole('checkbox', { name: 'Work' });
      tick('Work');

      await act(async () => {
        close();
      });

      expect(store.getState().globalState.isImportBookmarksOpen).toBe(false);
      expect(sessionTitles(store.getState())).toEqual([]);
      expect(remove).toHaveBeenCalledTimes(1);
    }
  );

  test('a library that cannot be read on open closes the dialog with the unreadable toast', async () => {
    getTree.mockRejectedValue(new Error('no bookmarks'));
    const { store } = await openDialog();

    await waitFor(() =>
      expect(store.getState().globalState.isImportBookmarksOpen).toBe(false)
    );
    expect(toastTexts(store.getState())).toContain(
      TOAST_MESSAGES.BOOKMARKS_UNREADABLE
    );
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('the import dialog: the sync size check', () => {
  test('a refused size dims Import and says why', async () => {
    vi.mocked(importSizeRefusal).mockResolvedValue({ used: '1.2', limit: '1' });
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });

    tick('Work');

    expect(
      await within(dialog()).findByText(
        'Too large to sync: this import would bring your sessions to 1.2 MB of the 1 MB limit. Untick some folders.'
      )
    ).toBeInTheDocument();
    expect(importButton()).toHaveAttribute('aria-disabled', 'true');
  });

  test('Import measures again before saving; a refusal then saves nothing', async () => {
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Work');
    await waitFor(() => expect(importSizeRefusal).toHaveBeenCalledTimes(1));
    // PREMISE: the settled check let it through.
    expect(importButton()).not.toHaveAttribute('aria-disabled');
    vi.mocked(importSizeRefusal).mockResolvedValue({ used: '1.2', limit: '1' });

    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(
      await within(dialog()).findByText(/Too large to sync/)
    ).toBeInTheDocument();
    expect(sessionTitles(store.getState())).toEqual([]);
    expect(store.getState().globalState.isImportBookmarksOpen).toBe(true);
    expect(importButton()).toHaveAttribute('aria-disabled', 'true');
  });

  test('five quick ticks are measured once, 300 ms after the last', async () => {
    vi.useFakeTimers();
    await openDialog();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    for (const name of ['Work', 'Recipes', 'Work', 'Kitchen remodel', 'Work'])
      tick(name);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(importSizeRefusal).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(importSizeRefusal).toHaveBeenCalledTimes(1);
    const [, measured] = vi.mocked(importSizeRefusal).mock.calls[0];
    expect(measured.map((s) => s.title)).toEqual([
      'Kitchen remodel',
      'Recipes',
      'Work',
    ]);
  });

  test('only the latest measurement applies', async () => {
    vi.useFakeTimers();
    let answerFirst: (v: { used: string; limit: string }) => void = () => {};
    vi.mocked(importSizeRefusal)
      .mockImplementationOnce(
        () => new Promise((resolve) => (answerFirst = resolve))
      )
      .mockResolvedValueOnce(null);
    await openDialog();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    tick('Kitchen remodel');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    tick('Kitchen remodel');
    tick('Work');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    // The first, slower answer lands after the second.
    await act(async () => {
      answerFirst({ used: '1.2', limit: '1' });
    });

    expect(importSizeRefusal).toHaveBeenCalledTimes(2);
    expect(within(dialog()).queryByText(/Too large to sync/)).toBeNull();
    expect(importButton()).not.toHaveAttribute('aria-disabled');
  });
});
