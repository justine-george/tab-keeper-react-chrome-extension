import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import ExportPage from '../../components/export/ExportPage';
import {
  renderWithProviders,
  RenderWithProvidersResult,
} from '../setup/renderWithProviders';

type RenderStore = RenderWithProvidersResult['store'];
import { hoverRulesFor } from '../setup/hoverRules';
import { newestToast, isToastShowing } from '../setup/toasts';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup, undo } from '../../redux/slices/undoRedoSlice';

// KAN-193. Export does nothing after `chrome.tabs.create`: a focused tab
// destroys the popup (KAN-122), which neither jsdom nor the e2e harness shows.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

// jsdom has no ClipboardItem; the fake keeps what it was given for read-back.
class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// tabs.create() rejects an unknown windowId, as Chrome does: seed a window.
const renderHeader = () =>
  renderWithProviders(<HeroContainerRight />, {
    seed: { windows: [{ id: 1 }] },
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SESSION])));
      // The startup seeding of history. Selecting no longer does it: the
      // session is already selected.
      store.dispatch(
        setPresentStartup({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );
    },
  });

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu');
};

describe('the session header keeps two actions and a menu (KAN-193)', () => {
  test('the header offers Open, Switch and More actions, and no loose export or delete icon', async () => {
    await renderHeader();

    for (const name of [
      'Open session, keeping current windows',
      'Close current windows and open this session',
      'More actions',
    ]) {
      expect(screen.queryByRole('button', { name }), name).not.toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Export…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete session' })).toBeNull();
  });

  // KAN-209. Cheap, heavier, destructive: Copy finishes here, Export opens a
  // tab, Delete goes last.
  test('the menu holds Copy, then Export, then Delete', async () => {
    const user = userEvent.setup();
    await renderHeader();

    const menu = await openMenu(user);

    // By accessible name: textContent includes each glyph's ligature text.
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items).toEqual([
      within(menu).getByRole('menuitem', { name: 'Copy all links' }),
      within(menu).getByRole('menuitem', { name: 'Export…' }),
      within(menu).getByRole('menuitem', { name: 'Delete session' }),
    ]);
  });

  // KAN-226. The ellipsis says a step follows: the click opens a preview.
  test('Export is named with an ellipsis and drawn with ios_share', async () => {
    const user = userEvent.setup();
    await renderHeader();

    const menu = await openMenu(user);
    const item = within(menu).getByRole('menuitem', { name: 'Export…' });

    expect(item.querySelector('.material-symbols-outlined')?.textContent).toBe(
      'ios_share'
    );
  });

  test('Export opens the export page for THAT session', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderHeader();

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Export…' }));

    expect(chrome.createdTabs).toHaveLength(1);
    expect(chrome.createdTabs[0].url).toContain('export.html');
    expect(chrome.createdTabs[0].url).toContain('session=session-kyoto');
  });

  // CONTROL: with one session seeded, a hardcoded index would pass.
  test('Export is for the selected session, not the first one', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderWithProviders(<HeroContainerRight />, {
      seed: { windows: [{ id: 1 }] },
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
    await user.click(screen.getByRole('menuitem', { name: 'Export…' }));

    expect(chrome.createdTabs[0].url).toContain('session=session-kyoto');
    expect(chrome.createdTabs[0].url).not.toContain('session-first');
  });

  // Asserts the clipboard: a spy passes against a handler that wrote nothing.
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

    // Without it a refused rich write copies nothing, silently.
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

    // KAN-210. Both halves: sessionToLinkHtml and sessionToLinkList tidy
    // separately.
    test('copies the session tidied, exactly as the export page does', async () => {
      const user = userEvent.setup();
      const { write } = fakeClipboard();
      await renderWithProviders(<HeroContainerRight />, {
        seedStore: (store) => {
          store.dispatch(
            replaceState(
              buildContainer([
                buildSession({
                  tabGroupId: 'session-untidy',
                  title: 'Weekend in Kyoto',
                  windows: [
                    {
                      windowId: 'w-1',
                      windowHeight: 1080,
                      windowWidth: 1920,
                      windowOffsetTop: 0,
                      windowOffsetLeft: 0,
                      tabCount: 2,
                      title: 'Trip planning',
                      tabs: [
                        {
                          tabId: 't-1',
                          favicon: '',
                          title: '(3) Nozomi timetable',
                          url: 'https://jr.example/nozomi',
                        },
                        {
                          tabId: 't-2',
                          favicon: '',
                          title: 'Extensions',
                          url: 'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Extensions&url=chrome%3A%2F%2Fextensions%2F&time=1',
                        },
                      ],
                    },
                  ],
                }),
              ])
            )
          );
          store.dispatch(selectTabContainer('session-untidy'));
        },
      });

      await openMenu(user);
      await user.click(
        screen.getByRole('menuitem', { name: 'Copy all links' })
      );

      await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const [[items]] = write.mock.calls as [[FakeClipboardItem[]]];
      const html = await items[0].items['text/html'].text();
      const plain = await items[0].items['text/plain'].text();

      for (const [version, copy] of [
        ['rich', html],
        ['plain', plain],
      ] as const) {
        expect(
          copy,
          `${version}: the count is not part of the title`
        ).toContain('Nozomi timetable');
        expect(copy, `${version}: the count is dropped`).not.toContain('(3)');
        expect(copy, `${version}: the real address is used`).toContain(
          'chrome://extensions/'
        );
        expect(
          copy,
          `${version}: the suspender's wrapper is gone`
        ).not.toContain('chrome-extension://');
      }
    });

    // Each path passing its own tests does not prove they match, so compare
    // bytes. With no edits, the page's `edited` is just its tidied session.
    test('the menu and the export page copy the same bytes', async () => {
      const user = userEvent.setup();
      const session = buildSession({
        tabGroupId: 'session-parity',
        title: 'Weekend in Kyoto',
        windows: [
          {
            windowId: 'w-1',
            windowHeight: 1080,
            windowWidth: 1920,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: 2,
            title: 'Trip planning',
            tabs: [
              {
                tabId: 't-1',
                favicon: '',
                title: '(3) Nozomi timetable',
                url: 'https://jr.example/nozomi',
              },
              {
                tabId: 't-2',
                favicon: '',
                title: 'Extensions',
                url: 'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Extensions&url=chrome%3A%2F%2Fextensions%2F&time=1',
              },
            ],
          },
        ],
      });
      const seed = (store: RenderStore) => {
        store.dispatch(replaceState(buildContainer([session])));
        store.dispatch(selectTabContainer('session-parity'));
      };

      const readCopy = async (write: ReturnType<typeof vi.fn>) => {
        const [[items]] = write.mock.calls as [[FakeClipboardItem[]]];
        return {
          html: await items[0].items['text/html'].text(),
          plain: await items[0].items['text/plain'].text(),
        };
      };

      const fromMenu = fakeClipboard();
      const menuRender = await renderWithProviders(<HeroContainerRight />, {
        seedStore: seed,
      });
      await openMenu(user);
      await user.click(
        screen.getByRole('menuitem', { name: 'Copy all links' })
      );
      await waitFor(() => expect(fromMenu.write).toHaveBeenCalledTimes(1));
      const menuCopy = await readCopy(fromMenu.write);
      menuRender.unmount();

      const fromPage = fakeClipboard();
      await renderWithProviders(
        <ExportPage source={{ kind: 'saved', tabGroupId: 'session-parity' }} />,
        {
          seedStore: seed,
        }
      );
      await user.click(
        await screen.findByRole('button', { name: 'Copy all links' })
      );
      await waitFor(() => expect(fromPage.write).toHaveBeenCalledTimes(1));
      const pageCopy = await readCopy(fromPage.write);

      expect(menuCopy.html).toBe(pageCopy.html);
      expect(menuCopy.plain).toBe(pageCopy.plain);
      // CONTROL: the comparison is not two empty strings agreeing.
      expect(menuCopy.html).toContain('Nozomi timetable');
      expect(menuCopy.plain).toContain('chrome://extensions/');
    });

    // The clipboard gives no feedback; the popup has no room for a note.
    test('says so, so the click is not silent', async () => {
      const user = userEvent.setup();
      fakeClipboard();
      const { store } = await renderHeader();

      await openMenu(user);
      await user.click(
        screen.getByRole('menuitem', { name: 'Copy all links' })
      );

      await waitFor(() => expect(isToastShowing(store.getState())).toBe(true));
      // The key, not the sentence: Toast renders t(toastText), and English
      // would pass with a key that resolves to nothing in other locales.
      expect(newestToast(store.getState())?.text).toBe('Links copied');
    });

    // CONTROL: the selected session, not the first.
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

  // Delete behind a menu is safe only because it is undoable: the undo
  // middleware captures DELETE_TAB_CONTAINER_ACTION.
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

  // Danger is a hover fill, not a resting colour. overflowMenu.test.tsx covers
  // the fill; this covers which item is marked.
  test('Delete is marked as the dangerous item, and Export is not', async () => {
    const user = userEvent.setup();
    await renderHeader();

    await openMenu(user);
    // Derived from the token, not pinned. jsdom normalises hex to rgb().
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
      hoverRulesFor(screen.getByRole('menuitem', { name: 'Export…' }))
    ).not.toMatch(DELETE_FILL);
  });
});
