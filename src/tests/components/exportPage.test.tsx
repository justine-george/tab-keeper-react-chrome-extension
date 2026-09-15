import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';

// KAN-190. The page that opens when a session is exported. It shows the file
// before it is saved -- that is its whole reason to exist, and the reason the
// download is a second click rather than the first.
//
// What is asserted here is the WIRING: that the page renders the generator's
// output, that the layout switch reaches it, and that saving writes the same
// string under the expected name. sessionExportHtml.test.ts holds the
// contents of that string; e2e/session-export.spec.ts proves a real browser
// writes a real file.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
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
          title: 'Fushimi Inari',
          url: 'https://inari.jp/en/',
        },
        {
          tabId: 't-2',
          favicon: '',
          title: 'Kyoto bus map',
          url: 'https://www2.city.kyoto.lg.jp/kotsu/',
        },
      ],
    },
  ],
});

const renderPage = (tabGroupId = 'session-kyoto') =>
  renderWithProviders(<ExportPage tabGroupId={tabGroupId} />, {
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SESSION])));
    },
  });

const frame = (): HTMLIFrameElement => {
  const found = document.querySelector('iframe');
  if (!found) throw new Error('the page renders no preview frame');
  return found as HTMLIFrameElement;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the export preview page (KAN-190)', () => {
  test('shows the session, and previews the very file that will be saved', async () => {
    await renderPage();

    expect(screen.getByText('Weekend in Kyoto')).toBeTruthy();
    await waitFor(() => {
      expect(frame().srcdoc).toContain('https://inari.jp/en/');
    });
    expect(frame().srcdoc).toContain('Kyoto bus map');
  });

  test('opens on the comfortable layout, with compact offered', async () => {
    await renderPage();

    expect(
      screen
        .getByRole('button', { name: 'Comfortable' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    // CONTROL: a marker that applies to both buttons marks nothing (KAN-95).
    expect(
      screen
        .getByRole('button', { name: 'Compact' })
        .getAttribute('aria-pressed')
    ).toBe('false');
  });

  test('switching to compact re-renders the file and moves the marker', async () => {
    const user = userEvent.setup();
    await renderPage();
    await waitFor(() => expect(frame().srcdoc).toContain('inari.jp'));
    const comfortable = frame().srcdoc;

    await user.click(screen.getByRole('button', { name: 'Compact' }));

    await waitFor(() => expect(frame().srcdoc).not.toBe(comfortable));
    expect(
      screen
        .getByRole('button', { name: 'Compact' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: 'Comfortable' })
        .getAttribute('aria-pressed')
    ).toBe('false');
    // Still the same session, in the other layout.
    expect(frame().srcdoc).toContain('https://inari.jp/en/');
  });

  test('saving writes the previewed file under the session name', async () => {
    const user = userEvent.setup();
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Save as HTML' }));

    expect(clicks).toHaveBeenCalled();
    const anchor = clicks.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(
      /^Weekend in Kyoto - \d{4}-\d{2}-\d{2}\.html$/
    );
  });

  test('copying puts a readable list on the clipboard, not a wall of URLs', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    // navigator.clipboard is a getter in jsdom, so it is spied rather than
    // assigned -- assigning throws "has only a getter".
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
      writeText,
    } as unknown as Clipboard);
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Copy all links' }));

    expect(writeText).toHaveBeenCalledWith(
      [
        'Weekend in Kyoto',
        '',
        'Window 1 · Trip planning (2 Tabs)',
        'Fushimi Inari (https://inari.jp/en/)',
        'Kyoto bus map (https://www2.city.kyoto.lg.jp/kotsu/)',
      ].join('\n')
    );
    expect(await screen.findByText('Links copied')).toBeTruthy();
  });

  // This page is its own document, so it boots its own store -- and nothing
  // fills that store for it. The popup's App does the loading for the popup;
  // without the same step here the page opens on "Session not found" for a
  // session that plainly exists, which is exactly what the first real-browser
  // run showed.
  test('loads the sessions from storage, because nothing else fills its store', async () => {
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([SESSION]))
    );

    await renderWithProviders(<ExportPage tabGroupId="session-kyoto" />);

    expect(await screen.findByText('Weekend in Kyoto')).toBeTruthy();
  });

  // Storage is not a contract: it can hold something older, or truncated.
  test('unreadable storage says not found rather than crashing', async () => {
    localStorage.setItem('tabContainerData', '{"tabGroups":"not an array"}');

    await renderWithProviders(<ExportPage tabGroupId="session-kyoto" />);

    expect(screen.getByText('Session not found')).toBeTruthy();
  });

  // The tab is a URL the user can pin or reload, so it has to say which
  // session it holds. "Tab Keeper" on five pinned export tabs says nothing.
  test('names the tab after the session', async () => {
    await renderPage();

    expect(document.title).toBe('Weekend in Kyoto');
  });

  // The worst path: the page is a URL, so it can be opened with an id that no
  // longer exists -- a bookmarked export tab, or a session deleted in the
  // popup after the tab was opened. It must say so, not crash or offer to save
  // an empty file.
  test('an id that matches no session says so, and offers nothing to save', async () => {
    await renderPage('session-that-was-deleted');

    expect(screen.getByText('Session not found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save as HTML' })).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  test('a session deleted while the page is open falls back to the same message', async () => {
    const { store } = await renderPage();
    expect(screen.getByText('Weekend in Kyoto')).toBeTruthy();

    act(() => {
      store.dispatch(replaceState(buildContainer([])));
    });

    expect(screen.getByText('Session not found')).toBeTruthy();
  });
});

// Found on a real export: the file followed the reader's SYSTEM setting, so
// exporting from the Light theme on a Mac in dark mode produced a dark file
// inside a light toolbar. The file takes its polarity from the Tab Keeper
// theme instead.
describe('the exported file matches the theme it was exported under', () => {
  const renderUnder = (theme: Theme) =>
    renderWithProviders(<ExportPage tabGroupId="session-kyoto" />, {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
        store.dispatch(setTheme(theme));
      },
    });

  test('a dark theme writes a dark file', async () => {
    await renderUnder(Theme.DARKENHEIMER);

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#17191d'));
  });

  // CONTROL: without this, a page that hardcoded dark would pass the test
  // above while being just as wrong as the bug it replaced.
  test('a light theme writes a light file', async () => {
    await renderUnder(Theme.LIGHT);

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#ffffff'));
  });
});

// The theme can change while this tab is open -- the popup is a separate
// document, and the two share storage. The preview has to follow, or the file
// saved after that switch is not the file on screen.
describe('the preview follows a theme change while the page is open', () => {
  test('switching to a dark theme re-renders the file dark', async () => {
    const { store } = await renderWithProviders(
      <ExportPage tabGroupId="session-kyoto" />,
      {
        seedStore: (s) => {
          s.dispatch(replaceState(buildContainer([SESSION])));
          s.dispatch(setTheme(Theme.LIGHT));
        },
      }
    );
    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#ffffff'));

    act(() => {
      store.dispatch(setTheme(Theme.BLUE));
    });

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#17191d'));
  });
});

// KAN-190. The theme decides the file's polarity by default, but the person
// exporting knows things the theme does not -- a dark document to print, a
// light one to send to a colleague. So the preview offers both, and the
// choice sticks.
describe('choosing the file light or dark on the preview page', () => {
  const renderUnder = (theme: Theme) =>
    renderWithProviders(<ExportPage tabGroupId="session-kyoto" />, {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
        store.dispatch(setTheme(theme));
      },
    });

  test('the switch opens on whatever the theme implies', async () => {
    await renderUnder(Theme.LIGHT);

    expect(
      screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')
    ).toBe('true');
    // CONTROL: a marker on both marks nothing (KAN-95).
    expect(
      screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')
    ).toBe('false');
  });

  test('choosing dark on a light theme rewrites the file dark', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);
    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#ffffff'));

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#17191d'));
    expect(
      screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')
    ).toBe('true');
  });

  // An explicit choice outranks the theme -- that is what "choice" means --
  // and it is remembered, so the next export opens the same way.
  test('the choice is kept, and outranks a later theme change', async () => {
    const user = userEvent.setup();
    const { store } = await renderUnder(Theme.LIGHT);

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    act(() => {
      store.dispatch(setTheme(Theme.WARM_LIGHT));
    });

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#17191d'));
    expect(store.getState().settingsDataState.exportScheme).toBe('dark');
  });
});

// The file prints as itself: the PDF a reader gets should be the page they
// were shown. e2e/session-export.spec.ts proves that against a real PDF.
describe('printing the previewed file', () => {
  test('the preview can be printed, which is how it becomes a PDF', async () => {
    const user = userEvent.setup();
    await renderPage();
    const printed = vi.fn();
    Object.defineProperty(frame(), 'contentWindow', {
      configurable: true,
      value: { print: printed },
    });

    await user.click(screen.getByRole('button', { name: 'Print' }));

    expect(printed).toHaveBeenCalled();
  });

  // Reaching into the frame at all needs same-origin: with sandbox="", the
  // page cannot call print() on it -- measured, it throws SecurityError.
  // Scripts stay blocked, so nothing in the file can run.
  test('the preview frame is reachable, and still cannot run scripts', async () => {
    await renderPage();

    const sandbox = frame().getAttribute('sandbox');
    // allow-modals is what makes print() work at all: without it Chrome logs
    // "Ignored call to 'print()'" and does nothing, which is exactly what
    // shipped in the first build of this page.
    expect(sandbox).toBe('allow-same-origin allow-modals');
    expect(sandbox).not.toContain('allow-scripts');
  });
});

// The Save button is filled with TEXT_COLOR, and Icon paints its glyph
// TEXT_COLOR -- so the download icon was drawn in the button's own background
// and disappeared. Asserted against the neighbouring button's icon rather
// than a literal, so it survives a palette change.
describe('the icon on the filled button (KAN-190)', () => {
  const glyphOf = (name: string) => {
    const button = screen.getByRole('button', { name });
    const glyph = button.querySelector('.material-symbols-outlined');
    if (!glyph) throw new Error('no glyph inside ' + name);
    return getComputedStyle(glyph).color;
  };

  test('the save icon is not painted in the fill it sits on', async () => {
    await renderPage();

    const save = screen.getByRole('button', { name: 'Save as HTML' });
    expect(glyphOf('Save as HTML')).not.toBe(
      getComputedStyle(save).backgroundColor
    );
  });

  test('CONTROL: an outline button keeps the ordinary icon colour', async () => {
    await renderPage();

    expect(glyphOf('Print')).not.toBe(glyphOf('Save as HTML'));
  });
});

// KAN-190. The toolbar was seven buttons of equal weight in the order they
// were added: two choices, three actions, nothing saying which was which --
// and at 800px it wrapped onto a second line.
//
// Option A, chosen from mocks: the choices become JOINED, LABELLED pairs (a
// segmented control means "pick one of these"), the actions sit apart from
// them, and Save is the one filled control, because it is why the page opened.
describe('the toolbar says which controls are choices (KAN-190)', () => {
  test('layout and colour are each a named group of exactly their own buttons', async () => {
    await renderPage();

    const layout = screen.getByRole('group', { name: 'Layout' });
    expect(
      within(layout)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Comfortable', 'Compact']);

    const colour = screen.getByRole('group', { name: 'Colour' });
    expect(
      within(colour)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Light', 'Dark']);
  });

  // An action inside a segmented pair would read as a fourth choice.
  test('the actions are not inside either group', async () => {
    await renderPage();

    const layout = screen.getByRole('group', { name: 'Layout' });
    const colour = screen.getByRole('group', { name: 'Colour' });

    for (const name of ['Print', 'Copy all links', 'Save as HTML']) {
      const button = screen.getByRole('button', { name });
      expect(layout.contains(button)).toBe(false);
      expect(colour.contains(button)).toBe(false);
    }
  });

  // Save carries a fill no other control has. Asserted against its NEIGHBOUR
  // rather than a literal colour, so it survives a palette change and still
  // fails if everything goes flat again.
  test('saving is the one filled control', async () => {
    await renderPage();

    const save = screen.getByRole('button', { name: 'Save as HTML' });
    const print = screen.getByRole('button', { name: 'Print' });

    const fill = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
    expect(fill(save)).not.toBe(fill(print));
  });
});
