import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CHALK_THEME, CHARCOAL_THEME } from '../../hooks/useThemeColors';
import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { newestToast } from '../setup/toasts';
import { rgb } from '../setup/hexColor';
import { EXPORT_PALETTE } from '../../utils/functions/sessionExportHtml';
import { getPrettyDate } from '../../utils/functions/local';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { readExportIcons } from '../../utils/functions/exportIcons';
import {
  markPressedSaveAsPdf,
  setCopyLinksLayout,
  setTheme,
  setTimeFormat,
  Theme,
} from '../../redux/slices/settingsDataStateSlice';

// KAN-603. Icons come from Chrome's cache in the real page; here each test says what the read answers.
vi.mock('../../utils/functions/exportIcons', async (original) => ({
  ...(await original<typeof import('../../utils/functions/exportIcons')>()),
  readExportIcons: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(readExportIcons).mockReset();
  vi.mocked(readExportIcons).mockResolvedValue(new Map());
});

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
    <ExportPage
      source={{ kind: 'saved', tabGroupId: tabGroupId }}
      from="full"
    />,
    {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
        // KAN-859. The copy tests below read the headed layout.
        store.dispatch(setCopyLinksLayout('with-headings'));
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

    expect(screen.getByTitle('Weekend in Kyoto')).toBe(frame());
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
  // layout pair is glyphs too since KAN-827: five lines against three.
  describe('both pairs are glyphs (KAN-212, KAN-827)', () => {
    // data-icon covers ligatures and SVG glyphs alike (Glyph.tsx).
    const glyphOf = (name: string) =>
      screen
        .getByRole('button', { name })
        .querySelector('[data-icon]')
        ?.getAttribute('data-icon');

    test('Light and Dark render a sun and a moon', async () => {
      await renderPage();

      expect(glyphOf('Light')).toBe('light_mode');
      expect(glyphOf('Dark')).toBe('dark_mode');
    });

    test('Compact and Comfortable render five lines and three', async () => {
      await renderPage();

      expect(glyphOf('Compact')).toBe('layout_compact');
      expect(glyphOf('Comfortable')).toBe('layout_comfortable');
    });

    // The glyph is aria-hidden, so the name must come from the label.
    test('each still carries its name and its tooltip', async () => {
      await renderPage();

      for (const name of ['Light', 'Dark', 'Compact', 'Comfortable']) {
        const button = screen.getByRole('button', { name });
        expect(button.getAttribute('aria-label')).toBe(name);
        expect(button.getAttribute('data-tooltip')).toBe(name);
      }
    });

    test('no Layout button shows its word as text', async () => {
      await renderPage();

      for (const name of ['Compact', 'Comfortable']) {
        expect(screen.getByRole('button', { name })).not.toHaveTextContent(
          name
        );
      }
      // CONTROL: glyphOf reads a glyph where one is drawn.
      expect(glyphOf('Light')).toBe('light_mode');
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
    const { store } = await renderPage();

    await user.click(screen.getByRole('button', { name: 'Copy all links' }));

    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    const { html, plain } = await copiedVersions(write);
    expect(html).toContain('<a href="https://inari.jp/en/">Fushimi Inari</a>');
    expect(plain).toContain(
      'WINDOW 1 · Trip planning (2 Tabs)\n- Fushimi Inari\n  https://inari.jp/en/'
    );
    expect(await screen.findByText('2 links copied.')).toBeTruthy();
    // KAN-401. The popup's toast, with the same key and count.
    expect(newestToast(store.getState())).toMatchObject({
      text: 'LinksCopied',
      params: { count: 2 },
    });
  });

  // KAN-401. Each copy is its own event: two copies are two toasts.
  test('copying twice shows two toasts', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
      write: vi.fn().mockResolvedValue(undefined),
      writeText: vi.fn(),
    } as unknown as Clipboard);
    const { store } = await renderPage();

    await user.click(screen.getByRole('button', { name: 'Copy all links' }));
    await user.click(screen.getByRole('button', { name: 'Copy all links' }));

    // The store, not the DOM: a replaced toast lingers on screen as it leaves.
    await waitFor(() =>
      expect(store.getState().globalState.toasts.map((t) => t.text)).toEqual([
        'LinksCopied',
        'LinksCopied',
      ])
    );
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

    expect(await screen.findByText('2 links copied.')).toBeTruthy();
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

    expect(await screen.findByText('2 links copied.')).toBeTruthy();
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
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />
    );

    expect(await screen.findByTitle('Weekend in Kyoto')).toBe(frame());
  });

  // Storage is not a contract: it can hold something older, or truncated.
  test('unreadable storage says not found rather than crashing', async () => {
    localStorage.setItem('tabContainerData', '{"tabGroups":"not an array"}');

    await renderWithProviders(
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />
    );

    expect(screen.getByText('Session not found')).toBeTruthy();
  });

  // A pinnable URL must say which session it holds.
  test('names the tab after the session', async () => {
    await renderPage();

    expect(document.title).toBe('Weekend in Kyoto');
  });

  // KAN-602. Chrome's menu Print… names the PDF after the page's title, so
  // while its dialog is open the title is the file's.
  test('beforeprint shows the edited title, afterprint the session title', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByRole('textbox', {
      name: 'Rename session: Weekend in Kyoto',
    });
    await user.clear(field);
    await user.type(field, 'Kyoto, edited');

    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(document.title).toBe('Kyoto, edited');
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(document.title).toBe('Weekend in Kyoto');
  });

  // KAN-602, spec call 3. Only Save as PDF… and its keys count as using it.
  test('a print from the menu does not dismiss the Save as PDF… pointer', async () => {
    const { store } = await renderPage();
    const before = store.getState().settingsDataState;
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(store.getState().settingsDataState).toBe(before);
  });

  test('the page holds a print-only copy of the file, with its edits', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByRole('textbox', {
      name: 'Rename tab: Fushimi Inari',
    });
    await user.clear(field);
    await user.type(field, 'Inari at dawn');

    const host = document.querySelector('[data-print-copy]');
    expect(host?.shadowRoot?.textContent).toContain('Inari at dawn');
  });

  test('a session that is not found has no print copy', async () => {
    await renderPage('session-that-was-deleted');
    expect(screen.getByText('Session not found')).toBeTruthy();
    expect(document.querySelector('[data-print-copy]')).toBeNull();
  });

  // Worst path: a bookmarked or stale URL whose session no longer exists.
  test('an id that matches no session says so, and offers nothing to save', async () => {
    await renderPage('session-that-was-deleted');

    expect(screen.getByText('Session not found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy all links' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save as PDF…' })).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  test('a session deleted while the page is open falls back to the same message', async () => {
    const { store } = await renderPage();
    expect(screen.getByTitle('Weekend in Kyoto')).toBe(frame());

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
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />,
      {
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([SESSION])));
          store.dispatch(setTheme(theme));
        },
      }
    );

  test('a dark theme writes a dark file', async () => {
    await renderUnder(Theme.DARKENHEIMER);

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#18191a'));
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
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />,
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

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#18191a'));
  });
});

// KAN-190. The theme sets the default; the page can override it.
describe('choosing the file light or dark on the preview page', () => {
  const renderUnder = (theme: Theme) =>
    renderWithProviders(
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />,
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

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#18191a'));
    expect(
      screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')
    ).toBe('true');
  });

  // KAN-731. The page's Dark switch is Charcoal whatever the theme it opened under.
  test('Dark on Paper paints the page and the file in Charcoal', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#18191a'));
    // The page's own ground: the outermost painted ancestor of the preview,
    // the header's colour since KAN-826, so the sheet reads as a page on it.
    const painted: HTMLElement[] = [];
    for (let el = frame().parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)') {
        painted.push(el);
      }
    }
    const ground = getComputedStyle(
      painted[painted.length - 1]
    ).backgroundColor;
    expect(ground).toBe(rgb(CHARCOAL_THEME.SECONDARY_COLOR));
  });

  // KAN-198. The choice lives only as long as the page; it is never saved.
  test('a choice made on the page holds while it is open, even if the theme changes', async () => {
    const user = userEvent.setup();
    const { store } = await renderUnder(Theme.LIGHT);

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    act(() => {
      store.dispatch(setTheme(Theme.WARM_LIGHT));
    });

    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#18191a'));
  });
});

// KAN-198. Header and file share one polarity; Light/Dark never touch the
// extension theme or settings.
describe('the whole page is light or dark, and the switch changes only the page (KAN-198)', () => {
  const renderUnder = (theme: Theme) =>
    renderWithProviders(
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />,
      {
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([SESSION])));
          store.dispatch(setTheme(theme));
        },
      }
    );

  // KAN-880. No band: the header lies on the page's ground, the first fill under Edit.
  const headerFill = () => {
    let el: HTMLElement = screen.getByRole('button', { name: 'Edit' });
    while (!el.hasAttribute('data-preview-header')) el = el.parentElement!;
    for (let up = el.parentElement; up; up = up.parentElement) {
      const fill = getComputedStyle(up).backgroundColor;
      if (fill && fill !== 'rgba(0, 0, 0, 0)') return fill;
    }
    return '';
  };
  const LIGHT_HEADER = rgb(CHALK_THEME.SECONDARY_COLOR);
  const DARK_HEADER = rgb(CHARCOAL_THEME.SECONDARY_COLOR);

  test('a dark theme opens with a dark header over a dark file', async () => {
    await renderUnder(Theme.BLUE);

    expect(headerFill()).toBe(DARK_HEADER);
    await waitFor(() => expect(frame().srcdoc).toContain('--bg:#18191a'));
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
    expect(copy.backgroundColor).toBe(rgb(CHARCOAL_THEME.PRIMARY_COLOR));
    expect(copy.color).toBe(rgb(CHARCOAL_THEME.TEXT_COLOR));
  });

  // The primary's fill follows the PAGE's light/dark, not the extension theme.
  test("the primary's fill follows the page's polarity too", async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(
      getComputedStyle(screen.getByRole('button', { name: 'Save as PDF…' }))
        .backgroundColor
    ).toBe(rgb(CHARCOAL_THEME.TEXT_COLOR));
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

    // KAN-603. Icons have settled (none here) and the frame has loaded them.
    await waitFor(() =>
      expect(frame().getAttribute('srcdoc')).toContain('data-icons="ready"')
    );
    fireEvent.load(frame());

    await user.click(screen.getByRole('button', { name: 'Save as PDF…' }));

    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
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

describe('the Save as PDF… pointer (KAN-826)', () => {
  // A 1280px window: the 816px sheet centred, Save as PDF… at the row's end.
  const SHEET = { left: 232, right: 1048, top: 140, bottom: 760 };
  const BUTTON = { left: 1000, right: 1120, top: 66, bottom: 100 };

  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1280);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const box =
          this.tagName === 'IFRAME'
            ? SHEET
            : this.getAttribute('aria-label') === 'Save as PDF…'
              ? BUTTON
              : { left: 0, right: 0, top: 0, bottom: 0 };
        return DOMRect.fromRect({
          x: box.left,
          y: box.top,
          width: box.right - box.left,
          height: box.bottom - box.top,
        });
      }
    );
  });

  const pointer = () => document.querySelector('[data-save-pdf-pointer]');

  test('shows with room, its tip under the middle of Save as PDF…', async () => {
    await renderPage();

    await waitFor(() => expect(pointer()).not.toBeNull());
    const line = pointer()!.querySelector('path')!.getAttribute('d')!;
    expect(line.split(/[ ,]+/).slice(-2).map(Number)).toEqual([1060, 108]);
  });

  test('is gone after a press on Save as PDF…, and the device remembers', async () => {
    const user = userEvent.setup();
    const { store } = await renderPage();
    Object.defineProperty(frame(), 'contentWindow', {
      configurable: true,
      value: { print: vi.fn() },
    });
    await waitFor(() => expect(pointer()).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Save as PDF…' }));

    expect(pointer()).toBeNull();
    expect(store.getState().settingsDataState.hasPressedSaveAsPdf).toBe(true);
  });

  test('is absent once this device has pressed Save as PDF…', async () => {
    await renderWithProviders(
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />,
      {
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([SESSION])));
          store.dispatch(markPressedSaveAsPdf());
        },
      }
    );

    expect(frame()).toBeTruthy();
    expect(pointer()).toBeNull();
  });

  test('is absent in edit mode', async () => {
    const user = userEvent.setup();
    await renderPage();
    await waitFor(() => expect(pointer()).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(pointer()).toBeNull();
  });

  test('is absent on "Session not found"', async () => {
    await renderPage('no-such-session');

    expect(screen.getByText('Session not found')).toBeTruthy();
    expect(pointer()).toBeNull();
  });
});

describe('⌘P and ⌘S run Save as PDF… (KAN-826)', () => {
  const renderMac = async () => {
    const r = await renderWithProviders(
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />,
      {
        seed: { platformOs: 'mac' },
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([SESSION])));
        },
      }
    );
    // Chrome's platform answer lands.
    await act(async () => {});
    return r;
  };

  const stubPrint = () => {
    const printed = vi.fn();
    Object.defineProperty(frame(), 'contentWindow', {
      configurable: true,
      value: { print: printed },
    });
    return printed;
  };

  const iconsLanded = async () => {
    await waitFor(() =>
      expect(frame().getAttribute('srcdoc')).toContain('data-icons="ready"')
    );
    fireEvent.load(frame());
  };

  // fireEvent answers false when a listener prevented the event.
  const key = (target: Window | Document | Element, init: KeyboardEventInit) =>
    fireEvent.keyDown(target, init);

  test.each([
    ['⌘P', { key: 'p', code: 'KeyP', metaKey: true }],
    ['⌘S', { key: 's', code: 'KeyS', metaKey: true }],
  ])(
    '%s prints the preview once and keeps the browser away',
    async (_n, init) => {
      const { store } = await renderMac();
      const printed = stubPrint();
      await iconsLanded();

      expect(key(window, init)).toBe(false);

      await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
      expect(store.getState().settingsDataState.hasPressedSaveAsPdf).toBe(true);
    }
  );

  test('pressed twice before the icons land, it prints once', async () => {
    const { store } = await renderMac();
    const printed = stubPrint();
    const setItem = vi.spyOn(localStorage, 'setItem');
    setItem.mockClear();

    expect(key(window, { key: 'p', code: 'KeyP', metaKey: true })).toBe(false);
    expect(key(window, { key: 'p', code: 'KeyP', metaKey: true })).toBe(false);
    await iconsLanded();

    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(printed).toHaveBeenCalledTimes(1);
    expect(store.getState().settingsDataState.hasPressedSaveAsPdf).toBe(true);
    const flagWrites = setItem.mock.calls.filter(
      ([k, v]) =>
        k === 'settingsData' && v.includes('"hasPressedSaveAsPdf":true')
    );
    expect(flagWrites).toHaveLength(1);
  });

  // Focus inside the preview: the keys reach the frame's document, not the page's.
  test('⌘P with focus in the preview prints it too', async () => {
    await renderMac();
    const printed = stubPrint();
    await iconsLanded();
    const doc = frame().contentDocument!;

    expect(key(doc, { key: 'p', code: 'KeyP', metaKey: true })).toBe(false);

    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
  });

  test('in edit mode ⌘P is kept from the browser and prints nothing, and the field keeps its text and focus', async () => {
    const user = userEvent.setup();
    await renderMac();
    const printed = stubPrint();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByRole('textbox', {
      name: 'Rename session: Weekend in Kyoto',
    });
    await user.click(field);
    await user.type(field, '!');

    expect(key(field, { key: 'p', code: 'KeyP', metaKey: true })).toBe(false);
    await act(async () => {});

    expect(printed).not.toHaveBeenCalled();
    expect(field).toHaveFocus();
    expect(field).toHaveValue('Weekend in Kyoto!');
  });

  // Emacs keys: Ctrl+P is "previous line" in a Mac text field.
  test('on a Mac, Ctrl+P in an edit field is left alone', async () => {
    const user = userEvent.setup();
    await renderMac();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByRole('textbox', {
      name: 'Rename session: Weekend in Kyoto',
    });

    expect(key(field, { key: 'p', code: 'KeyP', ctrlKey: true })).toBe(true);
  });

  // CONTROL: the page does not swallow every key.
  test('a plain P is left alone', async () => {
    await renderMac();
    const printed = stubPrint();

    expect(key(window, { key: 'p', code: 'KeyP' })).toBe(true);
    await act(async () => {});
    expect(printed).not.toHaveBeenCalled();
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

    const print = screen.getByRole('button', { name: 'Save as PDF…' });
    expect(glyphOf('Save as PDF…')).not.toBe(
      getComputedStyle(print).backgroundColor
    );
  });

  test('no outline action is painted in the fill it sits on either', async () => {
    await renderPage();

    for (const name of ['Edit', 'Copy all links']) {
      const button = screen.getByRole('button', { name });
      expect(glyphOf(name), name).not.toBe(
        getComputedStyle(button).backgroundColor
      );
    }
  });

  test('CONTROL: an outline button keeps the ordinary icon colour', async () => {
    await renderPage();

    expect(glyphOf('Edit')).toBe(glyphOf('Copy all links'));
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

    for (const name of ['Save as PDF…', 'Copy all links']) {
      const button = screen.getByRole('button', { name });
      expect(layout.contains(button)).toBe(false);
      expect(colour.contains(button)).toBe(false);
    }
  });

  // KAN-742. Save as HTML is gone (KAN-734 hid it); Copy ignores the choices, so it sits after them, and the PDF closes the row.
  test('the toolbar runs Edit, the choices, Copy all links, then Save as PDF…', async () => {
    await renderPage();

    const toolbar = document.querySelector('[data-toolbar-row]');
    if (!(toolbar instanceof HTMLElement)) throw new Error('no toolbar');
    expect(
      within(toolbar)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual([
      'Edit',
      'Compact',
      'Comfortable',
      'Light',
      'Dark',
      'Copy all links',
      'Save as PDF…',
    ]);
  });

  // Against neighbours, not a literal colour, so it survives a palette change.
  // Directional: Edit matching Copy is what fails if the fill moves to the
  // wrong control.
  test('the PDF output is the one filled control', async () => {
    await renderPage();

    const copy = screen.getByRole('button', { name: 'Copy all links' });
    const edit = screen.getByRole('button', { name: 'Edit' });
    const print = screen.getByRole('button', { name: 'Save as PDF…' });

    const fill = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
    expect(fill(print)).not.toBe(fill(copy));
    expect(fill(edit)).toBe(fill(copy));
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
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />,
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
      expect(frame().srcdoc).toContain(
        `Edited ${getPrettyDate(EDITED, 'en', 'h12')}`
      )
    );
  });

  // "Today" in a file is false from tomorrow on.
  test('a session edited today is dated, not "today"', async () => {
    const TODAY_EDIT = new Date(2026, 8, 29, 16, 12, 5).getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 29, 17, 7, 0));
    await renderWithProviders(
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />,
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
        `Edited ${getPrettyDate(TODAY_EDIT, 'en', 'h12')}`
      )
    );
    expect(frame().srcdoc).not.toMatch(/\btoday\b/i);
  });

  test('the file follows the time format (KAN-587)', async () => {
    const TODAY_EDIT = new Date(2026, 8, 29, 16, 12, 5).getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 29, 17, 7, 0));
    await renderWithProviders(
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />,
      {
        seedStore: (store) => {
          store.dispatch(setTimeFormat('h23'));
          store.dispatch(
            replaceState(
              buildContainer([{ ...SESSION, contentModified: TODAY_EDIT }])
            )
          );
        },
      }
    );

    await waitFor(() =>
      expect(frame().srcdoc).toContain('Edited Sep 29, 2026, 16:12:05')
    );
  });
});

// KAN-603. The page reads icons once per set of addresses, and Print waits for the file that carries them.
describe('the icons on the export page (KAN-603)', () => {
  const INARI = 'data:image/png;base64,SU5BUkk=';
  const OTHER = 'data:image/png;base64,T1RIRVI=';

  function deferred<T>() {
    const box: { resolve: (value: T) => void } = { resolve: () => {} };
    const promise = new Promise<T>((resolve) => {
      box.resolve = resolve;
    });
    return { promise, resolve: (value: T) => box.resolve(value) };
  }

  const srcdoc = () => frame().getAttribute('srcdoc') ?? '';

  // Every value the frame's document takes from here on.
  function watchSrcdoc() {
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(srcdoc()));
    observer.observe(frame(), {
      attributes: true,
      attributeFilter: ['srcdoc'],
    });
    return { seen, stop: () => observer.disconnect() };
  }

  const printButton = () =>
    screen.getByRole('button', { name: 'Save as PDF…' });

  const spyPrint = () => {
    const printed = vi.fn();
    Object.defineProperty(frame(), 'contentWindow', {
      configurable: true,
      value: { print: printed },
    });
    return printed;
  };

  test('reads the tidied addresses once, and lands every icon in one change', async () => {
    const read = deferred<ReadonlyMap<string, string>>();
    vi.mocked(readExportIcons).mockReturnValue(read.promise);
    await renderPage();

    expect(readExportIcons).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readExportIcons).mock.calls[0][0]).toEqual([
      'https://inari.jp/en/',
      'https://www2.city.kyoto.lg.jp/kotsu/',
    ]);
    expect(srcdoc()).not.toContain('data-icons');
    expect(srcdoc()).toContain('class="fav"');

    const watch = watchSrcdoc();
    await act(async () =>
      read.resolve(new Map([['https://inari.jp/en/', INARI]]))
    );
    await waitFor(() => expect(srcdoc()).toContain('data-icons="ready"'));
    watch.stop();

    expect(watch.seen).toHaveLength(1);
    expect(watch.seen[0]).toContain(INARI);
    expect(watch.seen[0]).toContain('data-icons="ready"');
  });

  test('a hide in Edit reads nothing again', async () => {
    const user = userEvent.setup();
    await renderPage();
    await waitFor(() => expect(srcdoc()).toContain('data-icons="ready"'));

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(
      screen.getByRole('button', { name: 'Hide: Fushimi Inari' })
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(srcdoc()).not.toContain('inari.jp');
    expect(readExportIcons).toHaveBeenCalledTimes(1);
  });

  test('a read answered after the addresses changed is dropped', async () => {
    const first = deferred<ReadonlyMap<string, string>>();
    const second = deferred<ReadonlyMap<string, string>>();
    vi.mocked(readExportIcons)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { store } = await renderPage();

    const moved = buildSession({
      ...SESSION,
      windows: [
        {
          ...SESSION.windows[0],
          tabs: [
            ...SESSION.windows[0].tabs,
            {
              tabId: 't-3',
              favicon: '',
              title: 'Nishiki Market',
              url: 'https://nishiki.example/',
            },
          ],
        },
      ],
    });
    act(() => {
      store.dispatch(replaceState(buildContainer([moved])));
    });
    await waitFor(() => expect(readExportIcons).toHaveBeenCalledTimes(2));

    await act(async () =>
      first.resolve(new Map([['https://inari.jp/en/', INARI]]))
    );
    expect(srcdoc()).not.toContain(INARI);
    expect(srcdoc()).not.toContain('data-icons');

    await act(async () =>
      second.resolve(new Map([['https://inari.jp/en/', OTHER]]))
    );
    await waitFor(() => expect(srcdoc()).toContain('data-icons="ready"'));
    expect(srcdoc()).toContain(OTHER);
    expect(srcdoc()).not.toContain(INARI);
  });

  test('when no icon can be read, every row keeps a bare slot, in the file and in Edit', async () => {
    const user = userEvent.setup();
    await renderPage();
    await waitFor(() => expect(srcdoc()).toContain('data-icons="ready"'));

    expect(
      srcdoc().split('<span class="fav" aria-hidden="true">').length - 1
    ).toBe(2);
    expect(srcdoc()).not.toContain('background-image');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const slots = document.querySelectorAll('[data-icon-slot]');
    expect(slots).toHaveLength(2);
    expect(document.querySelectorAll('[data-icon-slot] img')).toHaveLength(0);
  });

  describe('Print while the icons load', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // KAN-603. No "Preparing…" face: icons land 60-160ms after opening, before anyone can press.
    test('is busy at once with no second face, ignores a second press, and prints once the file with icons has loaded', async () => {
      const read = deferred<ReadonlyMap<string, string>>();
      vi.mocked(readExportIcons).mockReturnValue(read.promise);
      await renderPage();
      fireEvent.load(frame());
      const printed = spyPrint();
      vi.useFakeTimers();

      fireEvent.click(printButton());
      expect(printButton().getAttribute('aria-disabled')).toBe('true');
      expect(printButton().hasAttribute('data-second-face-shown')).toBe(false);

      fireEvent.click(printButton());
      await act(async () =>
        read.resolve(new Map([['https://inari.jp/en/', INARI]]))
      );
      expect(srcdoc()).toContain('data-icons="ready"');
      // The file with icons has been handed to the frame but not yet loaded.
      expect(printed).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.load(frame());
      });
      expect(printed).toHaveBeenCalledTimes(1);
      expect(printButton().getAttribute('aria-disabled')).toBeNull();
    });

    test('prints at 1s when the icons never arrive', async () => {
      vi.mocked(readExportIcons).mockReturnValue(new Promise(() => {}));
      await renderPage();
      fireEvent.load(frame());
      const printed = spyPrint();
      vi.useFakeTimers();

      fireEvent.click(printButton());
      await act(async () => vi.advanceTimersByTime(999));
      expect(printed).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(1));
      expect(printed).toHaveBeenCalledTimes(1);
      expect(printButton().getAttribute('aria-disabled')).toBeNull();
    });

    test('a print that throws still frees the button', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      await renderPage();
      await waitFor(() => expect(srcdoc()).toContain('data-icons="ready"'));
      fireEvent.load(frame());
      Object.defineProperty(frame(), 'contentWindow', {
        configurable: true,
        value: {
          print: () => {
            throw new DOMException('blocked', 'SecurityError');
          },
        },
      });

      fireEvent.click(printButton());

      await waitFor(() =>
        expect(printButton().getAttribute('aria-disabled')).toBeNull()
      );
      expect(error).toHaveBeenCalled();
    });
  });
});

// KAN-880. The header is the way back and the tools; the sheet carries the title.
describe('the way back, and the slim header (KAN-880)', () => {
  const backLink = () =>
    screen.getByRole('button', { name: 'Back to Tab Keeper' });
  const header = () =>
    screen
      .getByRole('button', { name: 'Back to Tab Keeper' })
      .closest('[data-preview-header]');

  // Chrome asks before closing only when beforeunload is cancelled.
  const closingAsks = (): boolean => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  const hideATab = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(
      screen.getByRole('button', { name: 'Hide: Fushimi Inari' })
    );
  };

  test('the header shows neither the title nor the counts; the sheet still does', async () => {
    await renderPage();

    expect(header()).not.toBeNull();
    expect(header()).not.toHaveTextContent('Weekend in Kyoto');
    expect(header()).not.toHaveTextContent('1 Window');
    expect(screen.queryByText('Weekend in Kyoto')).toBeNull();
    expect(frame().title).toBe('Weekend in Kyoto');
    await waitFor(() =>
      expect(frame().srcdoc).toContain('<h1>Weekend in Kyoto</h1>')
    );
  });

  test('while editing, the editor holds the title and the header still does not', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(header()).not.toHaveTextContent('Weekend in Kyoto');
    expect(
      screen.getByRole('textbox', { name: 'Rename session: Weekend in Kyoto' })
    ).toHaveValue('Weekend in Kyoto');
  });

  test('the link is there in Preview and in Editing, above the toolbar', async () => {
    const user = userEvent.setup();
    await renderPage();
    const precedes = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(
      precedes(backLink(), screen.getByRole('button', { name: 'Edit' }))
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(
      precedes(backLink(), screen.getByRole('button', { name: 'Done' }))
    ).toBe(true);
  });

  test('"Session not found" has the link too', async () => {
    await renderPage('session-that-was-deleted');

    expect(screen.getByText('Session not found')).toBeTruthy();
    expect(backLink()).toBeTruthy();
  });

  test('the capturing state has the link too', async () => {
    await renderWithProviders(
      <ExportPage source={{ kind: 'open-windows' }} from="full" />
    );

    expect(document.querySelector('[data-capturing]')).toBeTruthy();
    expect(backLink()).toBeTruthy();
  });

  test('the mode label reads Preview, then Editing, between the toolbar and the sheet', async () => {
    const user = userEvent.setup();
    await renderPage();
    const precedes = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    const preview = screen.getByText('Preview');
    expect(
      precedes(screen.getByRole('button', { name: 'Save as PDF…' }), preview)
    ).toBe(true);
    expect(precedes(preview, frame())).toBe(true);
    expect(header()!.contains(preview)).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByText('Preview')).toBeNull();
    const editing = screen.getByText('Editing');
    const title = screen.getByRole('textbox', {
      name: 'Rename session: Weekend in Kyoto',
    });
    expect(
      precedes(screen.getByRole('button', { name: 'Done' }), editing)
    ).toBe(true);
    expect(precedes(editing, title)).toBe(true);
    expect(header()!.contains(editing)).toBe(false);
  });

  test('the editor lies on the very sheet the file does', async () => {
    const user = userEvent.setup();
    await renderPage();
    const sheetClass = frame().className;

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const title = screen.getByRole('textbox', {
      name: 'Rename session: Weekend in Kyoto',
    });
    const sheet = title.closest(`.${sheetClass}`);
    expect(sheet).not.toBeNull();
    expect(getComputedStyle(sheet!).backgroundColor).toBe(
      rgb(EXPORT_PALETTE.light.bg)
    );
  });

  test('CONTROL: with a hidden tab and no press, closing still asks', async () => {
    const user = userEvent.setup();
    await renderPage();

    await hideATab(user);

    expect(closingAsks()).toBe(true);
  });

  test('Go back drops the guard before asking, so Chrome adds no "Leave site?"', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderPage();
    await hideATab(user);

    await user.click(backLink());
    await user.click(screen.getByRole('button', { name: 'Go back' }));

    expect(chrome.sentMessages).toContainEqual({
      type: 'returnFromPreview',
      from: 'full',
    });
    expect(closingAsks()).toBe(false);
  });

  test('Stay keeps the guard', async () => {
    const user = userEvent.setup();
    await renderPage();
    await hideATab(user);

    await user.click(backLink());
    await user.click(screen.getByRole('button', { name: 'Stay' }));

    expect(closingAsks()).toBe(true);
  });

  test('when going back fails, the page guards itself again', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderPage();
    vi.spyOn(chrome.runtime, 'sendMessage').mockRejectedValue(
      new Error('Receiving end does not exist.')
    );
    await hideATab(user);

    await user.click(backLink());
    await user.click(screen.getByRole('button', { name: 'Go back' }));

    await waitFor(() => expect(closingAsks()).toBe(true));
  });

  test('the address says where the preview came from, and the request carries it', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderWithProviders(
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="popup"
      />,
      {
        seedStore: (store) =>
          store.dispatch(replaceState(buildContainer([SESSION]))),
      }
    );

    await user.click(backLink());

    expect(chrome.sentMessages).toContainEqual({
      type: 'returnFromPreview',
      from: 'popup',
    });
  });
});
