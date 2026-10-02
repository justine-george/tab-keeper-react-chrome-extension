import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { getPrettyDate } from '../../utils/functions/local';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';

// KAN-190. Wiring only: the page previews the generator's output and saves that
// same string. File contents: sessionExportHtml.test.ts; real file:
// e2e/session-export.spec.ts.

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
  renderWithProviders(
    <ExportPage source={{ kind: 'saved', tabGroupId: tabGroupId }} />,
    {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
      },
    }
  );

const frame = (): HTMLIFrameElement => {
  const found = document.querySelector('iframe');
  if (!found) throw new Error('the page renders no preview frame');
  return found;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// jsdom has no ClipboardItem; the fake keeps what it was given so both versions
// can be read back.
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

  // KAN-212. Compact by default: exports are mostly lists to send, not
  // documents to print.
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

  // Measured: the worded colour pair costs 168.9px in Russian vs 125.5px in
  // English and wraps the row; a glyph costs the same in every language. The
  // density glyphs don't say which is roomier, so the layout pair keeps its
  // words.
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

    // The glyph is aria-hidden, so the name must come from the label.
    test('each still carries its name and its tooltip', async () => {
      await renderPage();

      for (const name of ['Light', 'Dark']) {
        const button = screen.getByRole('button', { name });
        expect(button.getAttribute('aria-label')).toBe(name);
        expect(button.getAttribute('title')).toBe(name);
      }
    });

    // CONTROL: the glyph test cannot pass by every segment becoming a glyph.
    test('Comfortable and Compact keep their words and carry no glyph', async () => {
      await renderPage();

      for (const name of ['Comfortable', 'Compact']) {
        expect(screen.getByRole('button', { name })).toHaveTextContent(name);
        expect(glyphOf(name)).toBeUndefined();
      }
    });
  });

  // Presses the non-default layout, so the press is never a no-op.
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
    expect(frame().srcdoc).toContain('https://inari.jp/en/');
  });

  test('saving writes the previewed file under the session name', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) blobs.push(blob);
      return 'blob:saved';
    });
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await renderPage();

    // Off the default, so a save that rebuilt the file would differ.
    await user.click(screen.getByRole('button', { name: 'Comfortable' }));
    await user.click(screen.getByRole('button', { name: 'Save as HTML' }));

    expect(blobs).toHaveLength(1);
    expect(await blobs[0].text()).toBe(frame().srcdoc);
    const anchor = clicks.mock.instances[0];
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error('no link');
    expect(anchor.download).toMatch(
      /^Weekend in Kyoto - \d{4}-\d{2}-\d{2}\.html$/
    );
  });

  // KAN-195. Rich HTML for editors that read it, plain text for the rest.
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

  // Its own document with its own store; the popup's App does not load it.
  test('loads the sessions from storage, because nothing else fills its store', async () => {
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([SESSION]))
    );

    await renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />
    );

    expect(await screen.findByText('Weekend in Kyoto')).toBeTruthy();
  });

  // Storage is not a contract: it can hold something older, or truncated.
  test('unreadable storage says not found rather than crashing', async () => {
    localStorage.setItem('tabContainerData', '{"tabGroups":"not an array"}');

    await renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />
    );

    expect(screen.getByText('Session not found')).toBeTruthy();
  });

  // A pinnable URL must say which session it holds.
  test('names the tab after the session', async () => {
    await renderPage();

    expect(document.title).toBe('Weekend in Kyoto');
  });

  // Worst path: a bookmarked or stale URL whose session no longer exists.
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

// The file's polarity comes from the Tab Keeper theme, not the reader's system
// setting.
describe('the exported file matches the theme it was exported under', () => {
  const renderUnder = (theme: Theme) =>
    renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
      {
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([SESSION])));
          store.dispatch(setTheme(theme));
        },
      }
    );

  test('a dark theme writes a dark file', async () => {
    await renderUnder(Theme.DARKENHEIMER);

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#171717'));
  });

  // CONTROL: a page that hardcoded dark would pass the test above.
  test('a light theme writes a light file', async () => {
    await renderUnder(Theme.LIGHT);

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#ffffff'));
  });
});

// The popup can change the theme while this tab is open; the saved file must
// match the screen.
describe('the preview follows a theme change while the page is open', () => {
  test('switching to a dark theme re-renders the file dark', async () => {
    const { store } = await renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
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

// KAN-190. The theme sets the default; the page can override it.
describe('choosing the file light or dark on the preview page', () => {
  const renderUnder = (theme: Theme) =>
    renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
      {
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([SESSION])));
          store.dispatch(setTheme(theme));
        },
      }
    );

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

  // KAN-198. The choice lives only as long as the page; it is never saved.
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

// KAN-198. Header and file share one polarity; Light/Dark never touch the
// extension theme or settings.
describe('the whole page is light or dark, and the switch changes only the page (KAN-198)', () => {
  const renderUnder = (theme: Theme) =>
    renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
      {
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([SESSION])));
          store.dispatch(setTheme(theme));
        },
      }
    );

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
    // An outline button's colours come only via ThemeColorsOverride, so it
    // proves the override reaches children. The primary's fill is a passed
    // style and would not.
    const copy = getComputedStyle(
      screen.getByRole('button', { name: 'Copy all links' })
    );
    expect(copy.backgroundColor).toBe('rgb(42, 42, 42)');
    expect(copy.color).toBe('rgb(208, 208, 208)');
  });

  // The primary's fill follows the PAGE's light/dark, not the extension theme.
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
    // CONTROL: the presses did something.
    expect(headerFill()).toBe(LIGHT_HEADER);
  });
});

// The real PDF is checked in e2e/session-export.spec.ts.
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

  // Measured: under sandbox="", print() on the frame throws SecurityError.
  test('the preview frame is reachable, and still cannot run scripts', async () => {
    await renderPage();

    const sandbox = frame().getAttribute('sandbox');
    // Measured: without allow-modals, Chrome ignores print().
    expect(sandbox).toBe('allow-same-origin allow-modals');
    expect(sandbox).not.toContain('allow-scripts');
  });
});

// KAN-190. Icon paints TEXT_COLOR by default, invisible on a TEXT_COLOR fill.
describe('the icon on the filled button (KAN-190)', () => {
  const glyphOf = (name: string) => {
    const button = screen.getByRole('button', { name });
    const glyph = button.querySelector('.material-symbols-outlined');
    if (!glyph) throw new Error('no glyph inside ' + name);
    return getComputedStyle(glyph).color;
  };

  test('the print icon is not painted in the fill it sits on', async () => {
    await renderPage();

    const print = screen.getByRole('button', { name: 'PDF / Print' });
    expect(glyphOf('PDF / Print')).not.toBe(
      getComputedStyle(print).backgroundColor
    );
  });

  test('no outline action is painted in the fill it sits on either', async () => {
    await renderPage();

    for (const name of ['Save as HTML', 'Copy all links']) {
      const button = screen.getByRole('button', { name });
      expect(glyphOf(name), name).not.toBe(
        getComputedStyle(button).backgroundColor
      );
    }
  });

  test('CONTROL: an outline button keeps the ordinary icon colour', async () => {
    await renderPage();

    expect(glyphOf('Save as HTML')).toBe(glyphOf('Copy all links'));
  });
});

// KAN-190. Choices are labelled segmented pairs, actions sit apart, and PDF /
// Print is the one filled control.
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

  // Copy ignores Layout and Colour, so it must not split the two outputs that
  // use them. KAN-207: the primary closes the row, like Done in the editing
  // toolbar.
  test('the actions run Copy, then Save, then Print', async () => {
    await renderPage();

    const names = ['Copy all links', 'Save as HTML', 'PDF / Print'];
    const actions = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
      .filter((name): name is string => names.includes(name ?? ''));
    expect(actions).toEqual(names);
  });

  // Against neighbours, not a literal colour, so it survives a palette change.
  // Directional: Save matching Copy is what fails if the fill moves to the
  // wrong control.
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

// KAN-347. A file is read later, so it keeps the full timestamp the popup
// trims. The clock is pinned so the fixture is "this year", where the trim
// would drop the year.
describe('the exported date line (KAN-347)', () => {
  const EDITED = new Date(2026, 8, 24, 2, 51, 57).getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  test('keeps the full timestamp, seconds and year', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 29, 17, 7, 0));
    await renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
      {
        seedStore: (store) => {
          store.dispatch(
            replaceState(
              buildContainer([{ ...SESSION, contentModified: EDITED }])
            )
          );
        },
      }
    );

    await waitFor(() =>
      expect(frame().srcdoc).toContain(`Edited ${getPrettyDate(EDITED, 'en')}`)
    );
  });

  // "Today" in a file is false from tomorrow on.
  test('a session edited today is dated, not "today"', async () => {
    const TODAY_EDIT = new Date(2026, 8, 29, 16, 12, 5).getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 29, 17, 7, 0));
    await renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
      {
        seedStore: (store) => {
          store.dispatch(
            replaceState(
              buildContainer([{ ...SESSION, contentModified: TODAY_EDIT }])
            )
          );
        },
      }
    );

    await waitFor(() =>
      expect(frame().srcdoc).toContain(
        `Edited ${getPrettyDate(TODAY_EDIT, 'en')}`
      )
    );
    expect(frame().srcdoc).not.toMatch(/\btoday\b/i);
  });
});
