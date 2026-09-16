import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { hoverRulesFor } from '../setup/hoverRules';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';

// KAN-193. The session header had four icons: Open, Switch, Export, Delete.
// The export icon was a download arrow, chosen when a click was going to
// download directly -- and then the flow changed to open a preview tab, so
// the icon promised something that no longer happened. Delete sat beside the
// two everyday actions, one mis-click away.
//
// Now: Open, Switch, and a More actions menu holding Export and Delete. A
// menu item carries words, so it cannot be misread the way a bare glyph was.
//
// The export item opens a tab and then does NOTHING, which is not a style
// choice. A tab taking focus destroys the popup, so work sequenced after
// `chrome.tabs.create` races a context Chrome has already torn down -- the
// KAN-122 class of bug, invisible here and to the e2e harness, which drives
// the popup as a tab that does not die.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

// jsdom has no ClipboardItem. The menu builds one per copy, so the fake keeps
// what it was given and the tests read both versions back out of it. Same shape
// as exportPage.test.tsx, which copies through the same helper.
class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderHeader = () =>
  renderWithProviders(<HeroContainerRight />, {
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SESSION])));
      store.dispatch(selectTabContainer('session-kyoto'));
    },
  });

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu');
};

describe('the session header keeps two actions and a menu (KAN-193)', () => {
  test('the header offers Open, Switch and More actions, and no loose export or delete icon', async () => {
    await renderHeader();

    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    // The two actions that moved are gone from the header itself -- a copy
    // left behind would make the menu decoration.
    expect(
      screen.queryByRole('button', { name: 'Export as PDF / HTML file' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete session' })).toBeNull();
  });

  // KAN-209 put Copy first. The order is cheap, heavier, destructive: Copy is
  // the only one of the three that FINISHES here -- Export opens a tab and
  // Delete changes the session -- so it reads as the lightest, and Delete stays
  // last where a destructive item belongs.
  test('the menu holds Copy, then Export, then Delete', async () => {
    const user = userEvent.setup();
    await renderHeader();

    const menu = await openMenu(user);

    // By accessible name, not textContent: each item's decorative glyph is a
    // ligature ("file_export"), so the raw text is not what anyone hears.
    // Found by name, then compared to the menu's own order.
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items).toEqual([
      within(menu).getByRole('menuitem', { name: 'Copy all links' }),
      within(menu).getByRole('menuitem', { name: 'Export as PDF / HTML file' }),
      within(menu).getByRole('menuitem', { name: 'Delete session' }),
    ]);
  });

  test('Export opens the export page for THAT session', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderHeader();

    await openMenu(user);
    await user.click(
      screen.getByRole('menuitem', { name: 'Export as PDF / HTML file' })
    );

    expect(chrome.createdTabs).toHaveLength(1);
    expect(chrome.createdTabs[0].url).toContain('export.html');
    expect(chrome.createdTabs[0].url).toContain('session=session-kyoto');
  });

  // CONTROL: the id in the URL is the SELECTED session, not the first one in
  // the list. With one session seeded, "the first" and "the selected" are the
  // same string and a hardcoded index would pass.
  test('Export is for the selected session, not the first one', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderWithProviders(<HeroContainerRight />, {
      seedStore: (store) => {
        store.dispatch(
          replaceState(
            buildContainer([
              buildSession({ tabGroupId: 'session-first', title: 'First' }),
              SESSION,
            ])
          )
        );
        store.dispatch(selectTabContainer('session-kyoto'));
      },
    });

    await openMenu(user);
    await user.click(
      screen.getByRole('menuitem', { name: 'Export as PDF / HTML file' })
    );

    expect(chrome.createdTabs[0].url).toContain('session=session-kyoto');
    expect(chrome.createdTabs[0].url).not.toContain('session-first');
  });

  // KAN-209. The one output that needs no preview: Copy ignores the layout and
  // colour choices entirely, so opening a tab to reach it was a detour. These
  // assert the CLIPBOARD, not that a function ran -- a spy on handleCopy would
  // pass against a handler that wrote nothing.
  describe('Copy all links, straight from the menu (KAN-209)', () => {
    const fakeClipboard = () => {
      const write = vi.fn().mockResolvedValue(undefined);
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('ClipboardItem', FakeClipboardItem);
      vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
        write,
        writeText,
      } as unknown as Clipboard);
      return { write, writeText };
    };

    test('puts the session on the clipboard as rich and plain text', async () => {
      const user = userEvent.setup();
      const { write } = fakeClipboard();
      await renderHeader();

      await openMenu(user);
      await user.click(
        screen.getByRole('menuitem', { name: 'Copy all links' })
      );

      await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const [[items]] = write.mock.calls as [[FakeClipboardItem[]]];
      const html = await items[0].items['text/html'].text();
      const plain = await items[0].items['text/plain'].text();
      expect(html).toContain(
        '<a href="https://example.com/">Example Domain</a>'
      );
      expect(plain).toContain('Example Domain');
      expect(plain).toContain('https://example.com/');
    });

    // The same fallback the export page has. Without it a refused rich write
    // copies NOTHING, silently -- the clipboard is the one place a caught
    // exception leaves no trace for the user to notice.
    test('falls back to plain text when the rich write is refused', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('ClipboardItem', FakeClipboardItem);
      const write = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
        write,
        writeText,
      } as unknown as Clipboard);
      await renderHeader();

      await openMenu(user);
      await user.click(
        screen.getByRole('menuitem', { name: 'Copy all links' })
      );

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText.mock.calls[0][0]).toContain('https://example.com/');
    });

    // Copying is silent otherwise: the clipboard gives no feedback of its own,
    // and unlike the export page there is no room here for an inline note.
    test('says so, so the click is not silent', async () => {
      const user = userEvent.setup();
      fakeClipboard();
      const { store } = await renderHeader();

      await openMenu(user);
      await user.click(
        screen.getByRole('menuitem', { name: 'Copy all links' })
      );

      await waitFor(() =>
        expect(store.getState().globalState.isToastOpen).toBe(true)
      );
      // The KEY, not the sentence: Toast renders t(toastText), and asserting
      // the English would pass with a key that resolves to nothing in the other
      // nine locales.
      expect(store.getState().globalState.toastText).toBe('Links copied');
    });

    // CONTROL: the id copied is the SELECTED session, not the first in the
    // list -- the same trap the Export test above guards.
    test('copies the selected session, not the first one', async () => {
      const user = userEvent.setup();
      const { write } = fakeClipboard();
      await renderWithProviders(<HeroContainerRight />, {
        seedStore: (store) => {
          store.dispatch(
            replaceState(
              buildContainer([
                buildSession({
                  tabGroupId: 'session-first',
                  title: 'First',
                  windows: [
                    {
                      windowId: 'w-first',
                      windowHeight: 1080,
                      windowWidth: 1920,
                      windowOffsetTop: 0,
                      windowOffsetLeft: 0,
                      tabCount: 1,
                      title: 'Other window',
                      tabs: [
                        {
                          tabId: 't-first',
                          favicon: '',
                          title: 'Decoy Page',
                          url: 'https://decoy.example/',
                        },
                      ],
                    },
                  ],
                }),
                SESSION,
              ])
            )
          );
          store.dispatch(selectTabContainer('session-kyoto'));
        },
      });

      await openMenu(user);
      await user.click(
        screen.getByRole('menuitem', { name: 'Copy all links' })
      );

      await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const [[items]] = write.mock.calls as [[FakeClipboardItem[]]];
      const plain = await items[0].items['text/plain'].text();
      expect(plain).toContain('https://example.com/');
      expect(plain).not.toContain('decoy.example');
    });
  });

  test('Delete removes the selected session', async () => {
    const user = userEvent.setup();
    const { store } = await renderHeader();

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete session' }));

    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.map((group) => group.tabGroupId)
    ).not.toContain('session-kyoto');
  });

  // Moving Delete behind a menu is safe only because deleting is recoverable:
  // DELETE_TAB_CONTAINER_ACTION is one of the middleware's captured actions.
  // If that ever stopped being true, this is what would say so.
  test('a session deleted from the menu comes back with Undo', async () => {
    const user = userEvent.setup();
    const { store } = await renderHeader();

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete session' }));
    const ids = () =>
      store
        .getState()
        .tabContainerDataState.tabGroups.map((group) => group.tabGroupId);
    expect(ids()).not.toContain('session-kyoto');

    act(() => {
      store.dispatch(undo());
    });

    expect(ids()).toContain('session-kyoto');
  });

  // Delete is the one destructive item, and it has to look like it. In this
  // menu that is a delete-coloured FILL on hover, the same as every other
  // danger item (overflowMenu.test.tsx holds the menu to that). What this
  // holds is the header's choice: Delete is marked danger, Export is not.
  //
  // The first version compared the glyphs' colour at rest -- both are the
  // text colour, because danger styling was never a resting colour. It failed
  // for the wrong reason, which is why it is asserted on the hover rule now.
  test('Delete is marked as the dangerous item, and Export is not', async () => {
    const user = userEvent.setup();
    await renderHeader();

    await openMenu(user);
    // Derived from the token, not pinned: KAN-204 changed this value in four
    // of the five themes, and the literal that used to sit here went stale
    // without failing until the theme moved under it. jsdom normalises the hex
    // emotion was given to rgb(), so both forms are accepted.
    const fill = LIGHT_THEME.DELETE_ICON_HOVER_COLOR;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
    const DELETE_FILL = new RegExp(
      `background-color:\\s*(${fill}|rgb\\(${r}, ?${g}, ?${b}\\))`,
      'i'
    );

    expect(
      hoverRulesFor(screen.getByRole('menuitem', { name: 'Delete session' }))
    ).toMatch(DELETE_FILL);
    expect(
      hoverRulesFor(
        screen.getByRole('menuitem', { name: 'Export as PDF / HTML file' })
      )
    ).not.toMatch(DELETE_FILL);
  });
});
