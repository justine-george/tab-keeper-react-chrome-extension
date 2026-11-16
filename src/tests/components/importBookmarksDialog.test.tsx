import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useDispatch, useSelector } from 'react-redux';

vi.mock('../../redux/bookmarkImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../redux/bookmarkImport')>()),
  importSizeRefusal: vi.fn(async () => null),
}));

import { ImportBookmarksDialog } from '../../components/modals/ImportBookmarksDialog';
import { renderWithProviders } from '../setup/renderWithProviders';
import { startBookmarkImport } from '../../redux/startBookmarkImport';
import { noteImportedBookmarks } from '../../redux/slices/settingsDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import {
  importedBookmarkIds,
  selectImportedBookmarks,
} from '../../redux/bookmarkImport';
import { importSizeRefusal } from '../../redux/bookmarkImport';
import type { AppDispatch, RootState } from '../../redux/store';
import { toastTexts } from '../setup/toasts';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { testI18n } from '../setup/i18nForTests';
import de from '../../../public/locales/de/translation.json';

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
  opts: { kitchenOwn?: number; withWork?: boolean; barLinks?: number } = {}
): Node[] => [
  folder('0', '', [
    folder(
      'bar',
      'Bookmarks Bar',
      [
        ...links('b', opts.barLinks ?? 3),
        folder('kitchen', 'Kitchen remodel', [
          ...links('k', opts.kitchenOwn ?? 3),
          folder('tiles', 'Tiles', links('t', 5)),
          folder('appl', 'Appliances', [
            ...links('a', 4),
            folder('fridges', 'Fridges', links('f', 2)),
          ]),
          folder('scraps', 'Scraps', []),
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
const row = (id: string): HTMLElement => {
  const found = dialog().querySelector(`[data-folder-row="${id}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`no row ${id}`);
  return found;
};
// A ticked row is drawn on the selection color; jsdom reads Emotion's rules back.
const background = (id: string) => getComputedStyle(row(id)).backgroundColor;
const previewTitles = () =>
  [...preview().querySelectorAll('[data-preview-session] > :first-child')].map(
    (el) => el.textContent
  );
const sessionTitles = (state: RootState) =>
  state.tabContainerDataState.tabGroups.map((g) => g.title);
// The bookmark ids no import may take again, sorted.
const recorded = (state: RootState) =>
  [...importedBookmarkIds(selectImportedBookmarks(state))].sort();
const selectAllButton = () =>
  within(dialog()).getByRole('button', { name: /^(Select|Deselect) all$/ });

beforeEach(() => {
  history.replaceState(null, '', '?view=tab');
  getTree.mockReset();
  getTree.mockResolvedValue(library());
  vi.mocked(importSizeRefusal).mockReset();
  vi.mocked(importSizeRefusal).mockResolvedValue(null);
});
afterEach(async () => {
  history.replaceState(null, '', '?');
  vi.useRealTimers();
  // The shared instance: a leaked locale would run later tests in it.
  await testI18n.changeLanguage('en');
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
      'Other Bookmarks',
    ]);
  });

  // KAN-862 R19. Nothing to import in it, so it isn't listed; a parent holding only empty folders isn't either.
  test('an empty folder is not listed', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    unfold('Kitchen remodel');
    expect(screen.queryByRole('checkbox', { name: 'Old stuff' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Scraps' })).toBeNull();
    expect(within(dialog()).queryByText('0 Bookmarks')).toBeNull();
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

  // KAN-862. The button keeps the verb; Settings' section of the same name is a noun (settingsRail.test).
  test('in German, Import with nothing ticked reads "Importieren"', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    testI18n.addResourceBundle('de', 'translation', de, true, true);
    await act(async () => {
      await testI18n.changeLanguage('de');
    });
    expect(screen.getByRole('button', { name: 'Importieren' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
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
  test('a ticked folder previews its session', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });

    tick('Kitchen remodel');

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

  // KAN-862 (11-16). Under a ticked folder the tree shows what each folder becomes, not a tick.
  test('under a ticked folder: a window mark on each subfolder, nothing deeper or empty, and no checkboxes', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    unfold('Kitchen remodel');
    unfold('Appliances');

    tick('Kitchen remodel');

    for (const id of ['tiles', 'appl', 'fridges'])
      expect(within(row(id)).queryByRole('checkbox')).toBeNull();
    for (const id of ['tiles', 'appl']) {
      expect(row(id)).toHaveTextContent('Becomes a window');
      expect(row(id)).toHaveTextContent('web_asset');
    }
    expect(row('fridges')).toHaveTextContent('Goes into the window above');
    expect(row('fridges')).not.toHaveTextContent('web_asset');
  });

  test('a top folder ticks each non-empty folder directly in it, and adds its loose links as a session', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });

    tick('Bookmarks Bar');

    for (const name of ['Bookmarks Bar', 'Kitchen remodel', 'Recipes', 'Work'])
      expect(box(name)).toHaveAttribute('aria-checked', 'true');
    expect(previewTitles()).toEqual([
      'Bookmarks Bar',
      'Kitchen remodel',
      'Recipes',
      'Work',
    ]);
    expect(importButton()).toHaveTextContent('Import 4 sessions');
  });

  test('a folder ticked by its top folder unticks on its own; the top folder stays ticked', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Bookmarks Bar');

    tick('Work');

    expect(box('Work')).toHaveAttribute('aria-checked', 'false');
    expect(box('Bookmarks Bar')).toHaveAttribute('aria-checked', 'true');
    expect(importButton()).toHaveTextContent('Import 3 sessions');
  });

  test('unticking a top folder clears the folders directly in it; a tick deeper down stays', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    tick('Bookmarks Bar');
    tick('Kitchen remodel');
    unfold('Kitchen remodel');
    tick('Tiles');

    tick('Bookmarks Bar');

    for (const name of ['Bookmarks Bar', 'Kitchen remodel', 'Recipes', 'Work'])
      expect(box(name)).toHaveAttribute('aria-checked', 'false');
    expect(box('Tiles')).toHaveAttribute('aria-checked', 'true');
    expect(previewTitles()).toEqual(['Tiles']);
  });

  test('ticking a top folder takes back ticks inside its folders, which then show marks', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    unfold('Kitchen remodel');
    tick('Tiles');

    tick('Bookmarks Bar');

    expect(within(row('tiles')).queryByRole('checkbox')).toBeNull();
    expect(row('tiles')).toHaveTextContent('Becomes a window');
    expect(previewTitles()).toEqual([
      'Bookmarks Bar',
      'Kitchen remodel',
      'Recipes',
      'Work',
    ]);
    // Taken back, not just covered: freed again, Tiles is not ticked.
    tick('Kitchen remodel');
    expect(box('Tiles')).toHaveAttribute('aria-checked', 'false');
  });

  test('a top folder with no loose links adds no session of its own', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Other Bookmarks' });

    tick('Other Bookmarks');

    expect(box('Other Bookmarks')).toHaveAttribute('aria-checked', 'true');
    expect(previewTitles()).toEqual(['Reading list']);
    expect(importButton()).toHaveTextContent('Import 1 session');
  });

  test('unticking the parent frees what it covered', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    unfold('Kitchen remodel');
    tick('Kitchen remodel');
    tick('Kitchen remodel');
    expect(box('Tiles')).toHaveAttribute('aria-checked', 'false');
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

  // A click on the name ticks, as a <label> would; the box alone was an 18px target.
  const nameOf = (name: string) => {
    const row = box(name).closest('[data-folder-row]');
    if (!(row instanceof HTMLElement)) throw new Error(`no row for ${name}`);
    return within(row).getByText(name);
  };

  test('a click on a folder name ticks it, and again unticks it', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    fireEvent.click(nameOf('Work'));
    expect(box('Work')).toHaveAttribute('aria-checked', 'true');
    expect(importButton()).toHaveTextContent('Import 1 session');
    fireEvent.click(nameOf('Work'));
    expect(box('Work')).toHaveAttribute('aria-checked', 'false');
  });

  test('a click on a marked row or its mark changes nothing', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    unfold('Kitchen remodel');
    unfold('Appliances');
    tick('Kitchen remodel');
    const marked = [
      within(row('tiles')).getByText('Tiles'),
      within(row('tiles')).getByText('Becomes a window'),
      within(row('fridges')).getByText('Fridges'),
      within(row('fridges')).getByText('Goes into the window above'),
    ];
    for (const target of marked) fireEvent.click(target);
    expect(within(row('tiles')).queryByRole('checkbox')).toBeNull();
    expect(row('tiles')).toHaveTextContent('Becomes a window');
    expect(box('Kitchen remodel')).toHaveAttribute('aria-checked', 'true');
    expect(importButton()).toHaveTextContent('Import 1 session');

    // Freed, none of those clicks left a tick behind.
    tick('Kitchen remodel');
    expect(box('Tiles')).toHaveAttribute('aria-checked', 'false');
    expect(box('Fridges')).toHaveAttribute('aria-checked', 'false');
    expect(background('tiles')).toBe(background('other'));
    expect(importButton()).toHaveTextContent(/^Import$/);
  });

  test('a click on the box ticks once; a click on the chevron only folds', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    tick('Kitchen remodel');
    expect(box('Kitchen remodel')).toHaveAttribute('aria-checked', 'true');
    unfold('Kitchen remodel');
    expect(row('tiles')).toHaveTextContent('Becomes a window');
    expect(box('Kitchen remodel')).toHaveAttribute('aria-checked', 'true');
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
    expect(recorded(store.getState())).toEqual([]);
    expect(toastTexts(store.getState())).toContain(
      TOAST_MESSAGES.BOOKMARKS_UNREADABLE
    );
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

// KAN-862 (11-16). What was imported once is left out of the tree on this device (R19, R22).
describe('the import dialog: bookmarks imported before', () => {
  const importedBefore = (ids: string[], tree: Node[] = library()) => {
    getTree.mockResolvedValue(tree);
    return openDialog({
      seedStore: (s) => {
        s.dispatch(
          noteImportedBookmarks([{ sessionId: 'old', bookmarkIds: ids }])
        );
      },
    });
  };
  const tagOf = (id: string) =>
    row(id).querySelector('[data-row-tag]')?.textContent;
  const listedRow = (id: string) =>
    dialog().querySelector(`[data-folder-row="${id}"]`);

  test('an imported folder and the folders in it are not listed; its parent counts what is left', async () => {
    await importedBefore(['kitchen']);
    await screen.findByRole('checkbox', { name: 'Recipes' });

    expect(
      screen.queryByRole('checkbox', { name: 'Kitchen remodel' })
    ).toBeNull();
    expect(listedRow('kitchen')).toBeNull();
    expect(tagOf('bar')).toBe(`${3 + 23 + 9} Bookmarks`);
  });

  test('a folder stays listed while anything in it is new, and goes once all of it is imported', async () => {
    await importedBefore(['tiles', 'appl']);
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    expect(tagOf('kitchen')).toBe('3 Bookmarks');
    // Nothing listed inside it any more, so nothing to unfold.
    expect(
      screen.queryByRole('button', { name: 'Expand: Kitchen remodel' })
    ).toBeNull();
  });

  test('a folder whose links all sit in imported folders is not listed', async () => {
    await importedBefore(['tiles', 'appl'], library({ kitchenOwn: 0 }));
    await screen.findByRole('checkbox', { name: 'Recipes' });
    expect(listedRow('kitchen')).toBeNull();
  });

  test('ticking Bookmarks Bar after Kitchen remodel was imported gives the remaining sessions only', async () => {
    await importedBefore(['kitchen']);
    await screen.findByRole('checkbox', { name: 'Recipes' });

    tick('Bookmarks Bar');

    expect(previewTitles()).toEqual(['Bookmarks Bar', 'Recipes', 'Work']);
    expect(importButton()).toHaveTextContent('Import 3 sessions');
  });

  test('with the bar’s loose links imported, its tick takes only its folders', async () => {
    await importedBefore(['b0', 'b1', 'b2']);
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    expect(tagOf('bar')).toBe(`${14 + 23 + 9} Bookmarks`);

    tick('Bookmarks Bar');

    expect(previewTitles()).toEqual(['Kitchen remodel', 'Recipes', 'Work']);
  });

  test('a link added to the bar after its loose links were imported makes the bar’s session again', async () => {
    await importedBefore(
      ['b0', 'b1', 'b2', 'kitchen', 'recipes', 'work'],
      library({ barLinks: 4 })
    );
    await screen.findByRole('checkbox', { name: 'Bookmarks Bar' });
    expect(tagOf('bar')).toBe('1 Bookmark');

    tick('Bookmarks Bar');

    expect(previewTitles()).toEqual(['Bookmarks Bar']);
    expect(within(preview()).getByText('1 Window · 1 Tab')).toBeInTheDocument();
  });

  test('a top folder with nothing left is not listed', async () => {
    await importedBefore(['b0', 'b1', 'b2', 'kitchen', 'recipes', 'work']);
    await screen.findByRole('checkbox', { name: 'Other Bookmarks' });
    expect(listedRow('bar')).toBeNull();
  });

  test('with everything imported, the tree says so, Select all is gone and Import stays dimmed', async () => {
    await importedBefore([
      'b0',
      'b1',
      'b2',
      'kitchen',
      'recipes',
      'work',
      'reading',
    ]);
    expect(
      await within(dialog()).findByText(
        'Everything in your bookmarks is already imported.'
      )
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(
      within(dialog()).queryByRole('button', {
        name: /^(Select|Deselect) all$/,
      })
    ).toBeNull();
    expect(importButton()).toHaveAttribute('aria-disabled', 'true');
  });

  test('a library with no links to import says so instead', async () => {
    getTree.mockResolvedValue([
      folder('0', '', [
        folder('bar', 'Bookmarks Bar', [folder('e', 'Empty', [])], {
          folderType: 'bookmarks-bar',
        }),
      ]),
    ]);
    await openDialog();
    expect(
      await within(dialog()).findByText('There are no bookmarks to import.')
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByText(
        'Everything in your bookmarks is already imported.'
      )
    ).toBeNull();
  });

  test('under a ticked folder, an imported folder is not listed and leaves the session', async () => {
    await importedBefore(['appl']);
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    unfold('Kitchen remodel');

    tick('Kitchen remodel');

    expect(row('tiles')).toHaveTextContent('Becomes a window');
    expect(listedRow('appl')).toBeNull();
    const windows = preview().querySelectorAll('[data-preview-window]');
    expect(
      [...windows].map(
        (w) => w.querySelector('[data-preview-window-name]')?.textContent
      )
    ).toEqual(['Kitchen remodel', 'Tiles']);
  });

  test('Import records what it took, the bar’s loose links by id; reopened, the dialog leaves it out', async () => {
    const { store } = await importedBefore(['appl']);
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    tick('Bookmarks Bar');
    tick('Recipes');

    await act(async () => {
      fireEvent.click(importButton());
    });
    await waitFor(() =>
      expect(store.getState().globalState.isImportBookmarksOpen).toBe(false)
    );
    // The fresh read at Import leaves the imported folder out too.
    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.map((g) => [g.title, g.tabCount])
    ).toEqual([
      ['Bookmarks Bar', 3],
      ['Kitchen remodel', 8],
      ['Work', 9],
    ]);
    expect(recorded(store.getState())).toEqual(
      ['appl', 'b0', 'b1', 'b2', 'kitchen', 'work'].sort()
    );

    await act(async () => {
      await store.dispatch(startBookmarkImport());
    });
    await screen.findByRole('checkbox', { name: 'Recipes' });
    for (const id of ['kitchen', 'work']) expect(listedRow(id)).toBeNull();
    expect(tagOf('bar')).toBe('23 Bookmarks');
  });

  // KAN-862 R21. ⌘Z on the import is as if it never happened.
  test('undoing the import lists its folders again', async () => {
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Work');
    await act(async () => {
      fireEvent.click(importButton());
    });
    await waitFor(() =>
      expect(store.getState().globalState.isImportBookmarksOpen).toBe(false)
    );
    expect(recorded(store.getState())).toEqual(['work']);

    act(() => {
      store.dispatch(undo());
    });
    expect(sessionTitles(store.getState())).toEqual([]);
    expect(recorded(store.getState())).toEqual([]);
    await act(async () => {
      await store.dispatch(startBookmarkImport());
    });
    expect(
      await screen.findByRole('checkbox', { name: 'Work' })
    ).toBeInTheDocument();
  });
});

// KAN-862 R20. One press ticks everything left; once all of it is ticked the same button clears it.
describe('the import dialog: Select all', () => {
  test('Select all ticks every top folder with something left, and so each folder in them', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    expect(selectAllButton()).toHaveTextContent('Select all');

    fireEvent.click(selectAllButton());

    for (const name of [
      'Bookmarks Bar',
      'Kitchen remodel',
      'Recipes',
      'Work',
      'Other Bookmarks',
    ])
      expect(box(name)).toHaveAttribute('aria-checked', 'true');
    expect(previewTitles()).toEqual([
      'Bookmarks Bar',
      'Kitchen remodel',
      'Recipes',
      'Work',
      'Reading list',
    ]);
    expect(selectAllButton()).toHaveTextContent('Deselect all');
  });

  test('Deselect all clears every tick', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    fireEvent.click(selectAllButton());

    fireEvent.click(selectAllButton());

    expect(
      screen
        .getAllByRole('checkbox')
        .filter((b) => b.getAttribute('aria-checked') === 'true')
    ).toEqual([]);
    expect(selectAllButton()).toHaveTextContent('Select all');
    expect(importButton()).toHaveTextContent(/^Import$/);
  });

  test('everything ticked by hand reads Deselect all; one unticked reads Select all again', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Bookmarks Bar');
    expect(selectAllButton()).toHaveTextContent('Select all');
    tick('Other Bookmarks');
    expect(selectAllButton()).toHaveTextContent('Deselect all');
    tick('Work');
    expect(selectAllButton()).toHaveTextContent('Select all');
  });

  test('Select all takes in a deeper tick: its folder is part of its parent’s session', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Kitchen remodel' });
    unfold('Kitchen remodel');
    tick('Tiles');

    fireEvent.click(selectAllButton());

    expect(row('tiles')).toHaveTextContent('Becomes a window');
    expect(previewTitles()).not.toContain('Tiles');
  });

  test('Select all leaves out what was imported', async () => {
    await openDialog({
      seedStore: (s) => {
        s.dispatch(
          noteImportedBookmarks([
            { sessionId: 'old', bookmarkIds: ['kitchen'] },
          ])
        );
      },
    });
    await screen.findByRole('checkbox', { name: 'Work' });

    fireEvent.click(selectAllButton());

    expect(previewTitles()).toEqual([
      'Bookmarks Bar',
      'Recipes',
      'Work',
      'Reading list',
    ]);
  });

  test('it is a button the keyboard reaches', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    const button = selectAllButton();
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    button.focus();
    expect(button).toHaveFocus();
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
    expect(recorded(store.getState())).toEqual([]);
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
    expect(recorded(store.getState())).toEqual([]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  // KAN-862 (11-16). Closed while the size was measured: that close was the answer, so nothing lands or is recorded.
  test('Esc while Import measures the size: nothing imports and nothing is recorded', async () => {
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Work');
    await waitFor(() => expect(importSizeRefusal).toHaveBeenCalledTimes(1));
    let answer: (refusal: null) => void = () => {};
    vi.mocked(importSizeRefusal).mockImplementation(
      () => new Promise((resolve) => (answer = resolve))
    );

    await act(async () => {
      fireEvent.click(importButton());
    });
    await waitFor(() => expect(importSizeRefusal).toHaveBeenCalledTimes(2));
    await act(async () => {
      fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    });
    await act(async () => {
      answer(null);
    });

    expect(store.getState().globalState.isImportBookmarksOpen).toBe(false);
    expect(sessionTitles(store.getState())).toEqual([]);
    expect(recorded(store.getState())).toEqual([]);
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
      expect(recorded(store.getState())).toEqual([]);
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
  test('a refusal goes with an emptied selection: the next tick does not bring it back', async () => {
    vi.mocked(importSizeRefusal).mockResolvedValue({ used: '1.2', limit: '1' });
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Work');
    await within(dialog()).findByText(/Too large to sync/);
    vi.mocked(importSizeRefusal).mockResolvedValue(null);

    tick('Work');
    tick('Kitchen remodel');

    // Before the next check answers: no old refusal standing for the new pick.
    expect(within(dialog()).queryByText(/Too large to sync/)).toBeNull();
  });

  test('after a refusal at Import, later checks measure the tree Import read', async () => {
    await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Kitchen remodel');
    await waitFor(() => expect(importSizeRefusal).toHaveBeenCalledTimes(1));
    getTree.mockResolvedValue(library({ kitchenOwn: 4 }));
    vi.mocked(importSizeRefusal).mockResolvedValueOnce({
      used: '1.2',
      limit: '1',
    });
    await act(async () => {
      fireEvent.click(importButton());
    });
    await within(dialog()).findByText(/Too large to sync/);
    vi.mocked(importSizeRefusal).mockClear();

    tick('Work');

    await waitFor(() => expect(importSizeRefusal).toHaveBeenCalled());
    const measured = vi.mocked(importSizeRefusal).mock.lastCall?.[1] ?? [];
    expect(measured.map((s) => [s.title, s.tabCount])).toEqual([
      ['Kitchen remodel', 15],
      ['Work', 9],
    ]);
  });

  test('a size that cannot be measured lets the import through, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(importSizeRefusal).mockRejectedValue(new Error('no compressor'));
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    tick('Work');
    await waitFor(() => expect(importSizeRefusal).toHaveBeenCalledTimes(1));
    expect(importButton()).not.toHaveAttribute('aria-disabled');

    await act(async () => {
      fireEvent.click(importButton());
    });

    await waitFor(() =>
      expect(sessionTitles(store.getState())).toEqual(['Work'])
    );
    expect(warn).toHaveBeenCalledWith(
      'Could not measure the import for sync:',
      expect.any(Error)
    );
    warn.mockRestore();
  });

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
    expect(recorded(store.getState())).toEqual([]);
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

describe('the import dialog: focus on close', () => {
  // The Settings button or setup card that opened it; the dialog mounts beside it, as in MainContainer.
  const HostWithOpener = () => {
    const dispatch: AppDispatch = useDispatch();
    return (
      <>
        <button
          type="button"
          onClick={() => void dispatch(startBookmarkImport())}
        >
          Opener
        </button>
        <Host />
      </>
    );
  };
  const openFromButton = async () => {
    const result = await renderWithProviders(<HostWithOpener />);
    Object.assign(globalThis.chrome, { bookmarks: { getTree } });
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    await act(async () => {
      fireEvent.click(opener);
    });
    await screen.findByRole('checkbox', { name: 'Work' });
    expect(document.activeElement).toBe(dialog());
    return { ...result, opener };
  };

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
  ])('%s gives focus back to what opened the dialog', async (_, close) => {
    const { opener } = await openFromButton();
    await act(async () => {
      close();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test('Import gives focus back to what opened the dialog', async () => {
    const { store, opener } = await openFromButton();
    tick('Work');
    await act(async () => {
      fireEvent.click(importButton());
    });
    await waitFor(() =>
      expect(store.getState().globalState.isImportBookmarksOpen).toBe(false)
    );
    expect(sessionTitles(store.getState())).toEqual(['Work']);
    expect(document.activeElement).toBe(opener);
  });

  test('an opener gone from the page is left alone: the close still ends the import', async () => {
    // Outside React, so the test can take it off the page as a re-render would.
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    const { store } = await openDialog();
    await screen.findByRole('checkbox', { name: 'Work' });
    opener.remove();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(store.getState().globalState.isImportBookmarksOpen).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
