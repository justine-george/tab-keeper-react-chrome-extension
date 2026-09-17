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
  vi.unstubAllGlobals();
});

// jsdom has no ClipboardItem. The page builds one per copy, so the fake keeps
// what it was given, and the test reads both versions back out of it.
class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

const copiedVersions = async (write: ReturnType<typeof vi.fn>) => {
  const [[items]] = write.mock.calls as [[FakeClipboardItem[]]];
  return {
    html: await items[0].items['text/html'].text(),
    plain: await items[0].items['text/plain'].text(),
  };
};

describe('the export preview page (KAN-190)', () => {
  test('shows the session, and previews the very file that will be saved', async () => {
    await renderPage();

    expect(screen.getByText('Weekend in Kyoto')).toBeTruthy();
    await waitFor(() => {
      expect(frame().srcdoc).toContain('https://inari.jp/en/');
    });
    expect(frame().srcdoc).toContain('Kyoto bus map');
  });

  // KAN-212 made compact the opening layout. The comfortable file spends a lot
  // of page on air, and the common reason to export is to send a list rather
  // than to print a document -- so the denser one is the better first answer,
  // and the other is one press away.
  //
  // Safe to change as a DEFAULT because export shipped after the v1.8.0 tag:
  // nobody has an exportLayout stored, so nobody's saved choice is overridden.
  test('opens on the compact layout, with comfortable offered', async () => {
    await renderPage();

    expect(
      screen
        .getByRole('button', { name: 'Compact' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    // CONTROL: a marker that applies to both buttons marks nothing (KAN-95).
    expect(
      screen
        .getByRole('button', { name: 'Comfortable' })
        .getAttribute('aria-pressed')
    ).toBe('false');
  });

  // KAN-212. The colour pair is the one control on this toolbar whose choice
  // has a symbol everyone already knows, and the row wraps in Russian at the
  // popup width -- measured, the pair costs 168.9px there against 125.5 in
  // English, while a glyph costs the same in every language.
  //
  // The LAYOUT pair deliberately keeps its words. density_large against
  // density_small is two sets of horizontal lines differing by a few pixels of
  // spacing, and neither says which one is roomier; matching the pairs by
  // making the readable one worse is consistency for its own sake.
  describe('the colour pair is glyphs, the layout pair is words (KAN-212)', () => {
    const glyphOf = (name: string) =>
      screen
        .getByRole('button', { name })
        .querySelector('.material-symbols-outlined')?.textContent;

    test('Light and Dark render a sun and a moon', async () => {
      await renderPage();

      expect(glyphOf('Light')).toBe('light_mode');
      expect(glyphOf('Dark')).toBe('dark_mode');
    });

    // The name has to survive losing the visible word -- it is what a screen
    // reader announces and what voice control is spoken to, and the glyph
    // itself is aria-hidden so it cannot stand in.
    test('each still carries its name and its tooltip', async () => {
      await renderPage();

      for (const name of ['Light', 'Dark']) {
        const button = screen.getByRole('button', { name });
        expect(button.getAttribute('aria-label')).toBe(name);
        expect(button.getAttribute('title')).toBe(name);
      }
    });

    // CONTROL: the layout pair is untouched, so this cannot pass by every
    // segment on the row having become a glyph.
    test('Comfortable and Compact keep their words and carry no glyph', async () => {
      await renderPage();

      for (const name of ['Comfortable', 'Compact']) {
        expect(screen.getByRole('button', { name })).toHaveTextContent(name);
        expect(glyphOf(name)).toBeUndefined();
      }
    });
  });

  // Switches AWAY from the opening layout, whichever that is. It used to press
  // Compact, which KAN-212 made the default -- so the press became a no-op, the
  // file did not re-render, and the test failed for the right reason. Pressing
  // the other one keeps it a test of the switch rather than of the default.
  test('switching layout re-renders the file and moves the marker', async () => {
    const user = userEvent.setup();
    await renderPage();
    await waitFor(() => expect(frame().srcdoc).toContain('inari.jp'));
    const compact = frame().srcdoc;

    await user.click(screen.getByRole('button', { name: 'Comfortable' }));

    await waitFor(() => expect(frame().srcdoc).not.toBe(compact));
    expect(
      screen
        .getByRole('button', { name: 'Comfortable' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: 'Compact' })
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

  // KAN-195. The clipboard carries a rich list for editors that read HTML and
  // a plain layout for everything else; the app pasted into picks one.
  test('copying puts a rich list and a plain one on the clipboard', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
      write,
      writeText,
    } as unknown as Clipboard);
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Copy all links' }));

    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    const { html, plain } = await copiedVersions(write);
    expect(html).toContain('<a href="https://inari.jp/en/">Fushimi Inari</a>');
    expect(plain).toContain(
      'WINDOW 1 · Trip planning (2 Tabs)\n- Fushimi Inari\n  https://inari.jp/en/'
    );
    expect(await screen.findByText('Links copied')).toBeTruthy();
  });

  // Where the rich write is refused -- or ClipboardItem does not exist -- the
  // links still get copied, as plain text, and the page still says so.
  test('when the rich copy is refused, the plain list is copied instead', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
      write,
      writeText,
    } as unknown as Clipboard);
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Copy all links' }));

    expect(await screen.findByText('Links copied')).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain(
      '- Fushimi Inari\n  https://inari.jp/en/'
    );
  });

  test('without ClipboardItem at all, the plain list is copied', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('ClipboardItem', undefined);
    const write = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
      write,
      writeText,
    } as unknown as Clipboard);
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Copy all links' }));

    expect(await screen.findByText('Links copied')).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
    expect(writeText.mock.calls[0][0]).toContain('- Kyoto bus map');
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

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#171717'));
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

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#171717'));
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

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#171717'));
    expect(
      screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')
    ).toBe('true');
  });

  // KAN-198. This was "the choice is kept, and outranks a later theme change":
  // the choice was saved, so one Light pressed once overrode a dark theme on
  // every later export. Now the choice belongs to this page while it is open,
  // and is never written anywhere.
  test('a choice made on the page holds while it is open, even if the theme changes', async () => {
    const user = userEvent.setup();
    const { store } = await renderUnder(Theme.LIGHT);

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    act(() => {
      store.dispatch(setTheme(Theme.WARM_LIGHT));
    });

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#171717'));
  });
});

// KAN-198. The page opens light or dark from the extension theme, and the
// header follows the same polarity as the file -- it is one page, not the
// extension's chrome around a document. Whatever Light or Dark does here stays
// on this page: the extension theme and saved settings are never touched.
describe('the whole page is light or dark, and the switch changes only the page (KAN-198)', () => {
  const renderUnder = (theme: Theme) =>
    renderWithProviders(<ExportPage tabGroupId="session-kyoto" />, {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
        store.dispatch(setTheme(theme));
      },
    });

  // The strip holding the session title and the toolbar.
  const headerFill = () => {
    let el: HTMLElement = screen.getByRole('button', { name: 'Edit' });
    while (!el.textContent?.includes('Weekend in Kyoto')) {
      el = el.parentElement!;
    }
    return getComputedStyle(el).backgroundColor;
  };
  const LIGHT_HEADER = 'rgb(233, 236, 240)';
  const DARK_HEADER = 'rgb(51, 51, 51)';

  test('a dark theme opens with a dark header over a dark file', async () => {
    await renderUnder(Theme.BLUE);

    expect(headerFill()).toBe(DARK_HEADER);
    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#171717'));
  });

  // A tinted light theme is still a light page: the header is light, not the
  // theme's pink.
  test('a light theme, even a tinted one, opens with a light header over a light file', async () => {
    await renderUnder(Theme.BB_PINK);

    expect(headerFill()).toBe(LIGHT_HEADER);
    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#ffffff'));
  });

  test('pressing Dark turns the header dark too, and the buttons with it', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);
    expect(headerFill()).toBe(LIGHT_HEADER);

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(headerFill()).toBe(DARK_HEADER);
    // An outline button styles nothing itself: its fill and text come from
    // the shared Button, which reads the colour hook. So this is what proves
    // the page's colours reach its children through ThemeColorsOverride.
    // (The primary's fill does NOT: the page passes it as a style, so it would
    // pass with the override ignored -- the first version of this test did.)
    const copy = getComputedStyle(
      screen.getByRole('button', { name: 'Copy all links' })
    );
    expect(copy.backgroundColor).toBe('rgb(42, 42, 42)');
    expect(copy.color).toBe('rgb(208, 208, 208)');
  });

  // The subject is whichever control carries the fill, not Save by name --
  // KAN-207 moved that to the PDF output and this followed it. What is pinned
  // is unchanged: the fill answers to the PAGE's light/dark, not the
  // extension's theme, so a dark page fills its primary with the dark palette's
  // text colour even though the extension is on a light theme.
  test("the primary's fill follows the page's polarity too", async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(
      getComputedStyle(screen.getByRole('button', { name: 'PDF / Print' }))
        .backgroundColor
    ).toBe('rgb(208, 208, 208)');
  });

  test('pressing Light or Dark changes neither the extension theme nor saved settings', async () => {
    const user = userEvent.setup();
    const { store } = await renderUnder(Theme.DARKENHEIMER);
    const settingsBefore = store.getState().settingsDataState;
    const storedBefore = localStorage.getItem('settingsData');

    await user.click(screen.getByRole('button', { name: 'Light' }));
    await user.click(screen.getByRole('button', { name: 'Dark' }));
    await user.click(screen.getByRole('button', { name: 'Light' }));

    expect(store.getState().settingsDataState).toEqual(settingsBefore);
    expect(store.getState().settingsDataState.theme).toBe(Theme.DARKENHEIMER);
    expect(localStorage.getItem('settingsData')).toBe(storedBefore);
    // CONTROL: the presses did something -- the page itself is light now.
    expect(headerFill()).toBe(LIGHT_HEADER);
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

    await user.click(screen.getByRole('button', { name: 'PDF / Print' }));

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

    expect(glyphOf('PDF / Print')).not.toBe(glyphOf('Save as HTML'));
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
    ).toEqual(['Compact', 'Comfortable']);

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

    for (const name of ['PDF / Print', 'Copy all links', 'Save as HTML']) {
      const button = screen.getByRole('button', { name });
      expect(layout.contains(button)).toBe(false);
      expect(colour.contains(button)).toBe(false);
    }
  });

  // Print and Save both output the page the Layout and Colour choices just
  // rendered; Copy writes plain "title (link)" text that ignores both. So the
  // two outputs sit together and Copy goes first rather than splitting them.
  //
  // KAN-207 put the PDF output last. The rule Copy answers to is unchanged --
  // it must not sit BETWEEN the two outputs, and it still does not -- so only
  // the outputs swapped with each other. The primary now closes the row, which
  // is where the editing toolbar already puts Done.
  test('the actions run Copy, then Save, then Print', async () => {
    await renderPage();

    const names = ['Copy all links', 'Save as HTML', 'PDF / Print'];
    const actions = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
      .filter((name): name is string => names.includes(name ?? ''));
    expect(actions).toEqual(names);
  });

  // The PDF output carries a fill no other control has. Asserted against its
  // NEIGHBOURS rather than a literal colour, so it survives a palette change
  // and still fails if everything goes flat again.
  //
  // DIRECTIONAL, and the version this replaces was not: it asserted only that
  // Save and Print differ, which stays true no matter which of them is filled.
  // It would have passed unchanged through KAN-207 moving the fill from one to
  // the other -- the exact change it sat next to. Naming the unfilled controls
  // is what makes it able to say the fill is on the wrong one.
  test('the PDF output is the one filled control', async () => {
    await renderPage();

    const copy = screen.getByRole('button', { name: 'Copy all links' });
    const save = screen.getByRole('button', { name: 'Save as HTML' });
    const print = screen.getByRole('button', { name: 'PDF / Print' });

    const fill = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
    expect(fill(print)).not.toBe(fill(copy));
    expect(fill(save)).toBe(fill(copy));
  });
});
