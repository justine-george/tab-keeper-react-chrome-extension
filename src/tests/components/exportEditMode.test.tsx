import { afterEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportEditor from '../../components/export/ExportEditor';
import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import {
  exportRowKey,
  NO_EXPORT_EDITS,
  type ExportEdits,
} from '../../utils/functions/sessionExportEdits';
import {
  EXPORT_PALETTE,
  type ExportScheme,
} from '../../utils/functions/sessionExportHtml';

// KAN-734. The build ships Save as HTML hidden; tests that need it turn it on.
const saveSwitch = vi.hoisted(() => ({ shown: false }));
vi.mock('../../utils/constants/common', async (original) => ({
  ...(await original<typeof import('../../utils/constants/common')>()),
  get IS_SAVE_AS_HTML_SHOWN() {
    return saveSwitch.shown;
  },
}));

// The wiring: edits reach every output and never the saved session.
// What an edit does to the document is in sessionExportEdits.test.ts.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
  windowCount: 2,
  tabCount: 4,
  windows: [
    {
      windowId: 'w-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 3,
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
          title: 'Nozomi timetable',
          url: 'https://jr.example/nozomi',
          chromeGroupId: 'g-1',
        },
        {
          tabId: 't-3',
          favicon: '',
          title: 'Order Details - Apple',
          url: 'https://secure.store.apple.example/order',
        },
      ],
      chromeTabGroups: [{ groupId: 'g-1', title: 'Flights', color: 'blue' }],
    },
    {
      windowId: 'w-2',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Food',
      tabs: [
        {
          tabId: 't-4',
          favicon: '',
          title: 'Nishiki Market',
          url: 'https://nishiki.example/',
        },
      ],
    },
  ],
});

const renderPage = () =>
  renderWithProviders(
    <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
    {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
      },
    }
  );

const preview = (): string => {
  const frame = document.querySelector('iframe');
  if (!frame) throw new Error('the page shows no file preview');
  return frame.srcdoc;
};

type User = ReturnType<typeof userEvent.setup>;

const rename = async (user: User, fieldName: string, value: string) => {
  const field = screen.getByRole('textbox', { name: fieldName });
  await user.clear(field);
  if (value) await user.type(field, value);
};

// Chrome asks before closing only when beforeunload is cancelled.
const closingAsks = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  saveSwitch.shown = false;
});

// jsdom has no ClipboardItem; the fake keeps both versions for the test to
// read.
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

describe('Edit mode on the export page (KAN-194)', () => {
  test('Edit swaps the preview for editable rows, and the toolbar for Reset and Done', async () => {
    saveSwitch.shown = true;
    const user = userEvent.setup();
    await renderPage();
    expect(document.querySelector('iframe')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'Rename session: Weekend in Kyoto' })
    ).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'Rename tab: Fushimi Inari' })
    ).toBeTruthy();
    // Nothing leaves the page from the editing form.
    expect(document.querySelector('iframe')).toBeNull();
    for (const name of [
      'Copy all links',
      'PDF / Print',
      'Save as HTML',
      'Comfortable',
      'Light',
      'Edit',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  test('Done shows the file again, with the rename in it', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await rename(user, 'Rename tab: Fushimi Inari', 'Inari shrine');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(preview()).toContain('Inari shrine');
    expect(preview()).not.toContain('Fushimi Inari');
    expect(preview()).toContain('https://inari.jp/en/');
  });

  test('a hidden tab is left out of the file, and the counts follow', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(
      screen.getByRole('button', { name: 'Hide: Order Details - Apple' })
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(preview()).not.toContain('secure.store.apple.example');
    expect(screen.getByText('2 Windows · 3 Tabs')).toBeTruthy();
  });

  test('a hidden row stays on screen, marked, and the same control brings it back', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const eye = screen.getByRole('button', {
      name: 'Hide: Order Details - Apple',
    });

    await user.click(eye);

    expect(eye.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('textbox', { name: 'Rename tab: Order Details - Apple' })
    ).toBeTruthy();

    await user.click(eye);
    expect(eye.getAttribute('aria-pressed')).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(preview()).toContain('secure.store.apple.example');
  });

  test('hiding a group leaves out its tabs and its band', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Hide: Flights' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(preview()).not.toContain('jr.example/nozomi');
    expect(preview()).not.toContain('Flights');
    // CONTROL: the rest of its window is still there.
    expect(preview()).toContain('https://inari.jp/en/');
  });

  test('the tally says what the file will change', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    await rename(user, 'Rename window: Food', 'Where to eat');
    await user.click(
      screen.getByRole('button', { name: 'Hide: Fushimi Inari' })
    );

    expect(screen.getByText('1 renamed · 1 hidden')).toBeTruthy();
  });

  test('Reset puts every title and row back', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await rename(user, 'Rename tab: Fushimi Inari', 'Inari shrine');
    await user.click(screen.getByRole('button', { name: 'Hide: Food' }));

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(
      (
        screen.getByRole('textbox', {
          name: 'Rename tab: Fushimi Inari',
        }) as HTMLInputElement
      ).value
    ).toBe('Fushimi Inari');
    expect(
      screen
        .getByRole('button', { name: 'Hide: Food' })
        .getAttribute('aria-pressed')
    ).toBe('false');
    expect(screen.getByText('0 renamed · 0 hidden')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(preview()).toContain('Fushimi Inari');
    expect(preview()).toContain('https://nishiki.example/');
  });

  test('a cleared session title keeps its name in the file', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await rename(user, 'Rename session: Weekend in Kyoto', '');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(preview()).toContain('<h1>Weekend in Kyoto</h1>');
  });

  test('Save writes the edited file, under the edited name', async () => {
    saveSwitch.shown = true;
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:edited';
    });
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await rename(user, 'Rename session: Weekend in Kyoto', 'Kyoto links');
    await user.click(
      screen.getByRole('button', { name: 'Hide: Order Details - Apple' })
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save as HTML' }));

    const anchor = clicks.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^Kyoto links - \d{4}-\d{2}-\d{2}\.html$/);
    const file = await blobs[0].text();
    expect(file).toContain('<h1>Kyoto links</h1>');
    expect(file).not.toContain('secure.store.apple.example');
  });

  test('Copy all links puts the edited list on the clipboard, in both versions', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
      write,
      writeText: vi.fn(),
    } as unknown as Clipboard);
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await rename(user, 'Rename tab: Fushimi Inari', 'Inari shrine');
    await user.click(
      screen.getByRole('button', { name: 'Hide: Order Details - Apple' })
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Copy all links' }));

    const { html, plain } = await copiedVersions(write);
    expect(plain).toContain('- Inari shrine\n  https://inari.jp/en/');
    expect(html).toContain('>Inari shrine</a>');
    for (const version of [plain, html]) {
      expect(version).not.toContain('secure.store.apple.example');
    }
  });

  // KAN-401. The note counts the links copied, so hidden rows are not in it.
  test('the copy note counts only the links the copy holds', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
      write: vi.fn().mockResolvedValue(undefined),
      writeText: vi.fn(),
    } as unknown as Clipboard);
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Hide: Flights' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Copy all links' }));
    // 4 tabs, the Flights group's 1 hidden.
    expect(await screen.findByText('3 links copied.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Hide: Food' }));
    await user.click(
      screen.getByRole('button', { name: 'Hide: Fushimi Inari' })
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Copy all links' }));
    expect(await screen.findByText('1 link copied.')).toBeTruthy();
  });

  // KAN-401 C. With every row hidden there is nothing to export, so Edit
  // cannot be finished until one row is shown again.
  test('with every row hidden, Done is unavailable and says why', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(
      screen.getByRole('button', { name: 'Hide: Trip planning' })
    );
    await user.click(screen.getByRole('button', { name: 'Hide: Food' }));

    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toHaveAttribute('aria-disabled', 'true');
    expect(done).toHaveAttribute(
      'data-tooltip',
      'Every row is hidden. Show one to finish.'
    );
    await user.click(done);
    // Still editing: the outputs never appear with nothing to export.
    expect(
      screen.queryByRole('button', { name: 'Copy all links' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();

    // CONTROL: one row back, and Done finishes.
    await user.click(screen.getByRole('button', { name: 'Hide: Food' }));
    expect(screen.getByRole('button', { name: 'Done' })).not.toHaveAttribute(
      'aria-disabled'
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      screen.getByRole('button', { name: 'Copy all links' })
    ).toBeInTheDocument();
  });

  // The popup owns renaming, with undo and sync; a second writer would have
  // neither.
  test('the saved session is never changed', async () => {
    const user = userEvent.setup();
    const { store } = await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await rename(user, 'Rename session: Weekend in Kyoto', 'Kyoto links');
    await rename(user, 'Rename tab: Fushimi Inari', 'Inari shrine');
    await user.click(screen.getByRole('button', { name: 'Hide: Food' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(store.getState().tabContainerDataState.tabGroups).toEqual([
      { ...SESSION, isSelected: true },
    ]);
  });
});

describe('closing the page with edits pending (KAN-194)', () => {
  test('with no edits, closing does not ask', async () => {
    await renderPage();

    expect(closingAsks()).toBe(false);
  });

  test('with an edit, closing asks first', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Hide: Food' }));

    expect(closingAsks()).toBe(true);
    // Done keeps nothing, so closing still asks.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(closingAsks()).toBe(true);
  });

  test('after Reset, closing does not ask', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await rename(user, 'Rename tab: Fushimi Inari', 'Inari shrine');

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(closingAsks()).toBe(false);
  });

  test('after saving the edited file, closing does not ask until the next edit', async () => {
    saveSwitch.shown = true;
    const user = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:edited');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Hide: Food' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Save as HTML' }));
    expect(closingAsks()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await rename(user, 'Rename tab: Fushimi Inari', 'Inari shrine');
    expect(closingAsks()).toBe(true);
  });
  // KAN-734. The page cannot tell a saved PDF from a cancelled dialog.
  test('with Save hidden, printing does not count as keeping the edits', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Hide: Food' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    const printed = vi.fn();
    Object.defineProperty(document.querySelector('iframe'), 'contentWindow', {
      configurable: true,
      value: { print: printed },
    });

    await user.click(screen.getByRole('button', { name: 'PDF / Print' }));

    expect(printed).toHaveBeenCalled();
    expect(closingAsks()).toBe(true);
  });
});

describe('the page names its mode above the title (KAN-194)', () => {
  // The smallest box holding both; it reaches the toolbar only if the label
  // does.
  const sharedBox = (a: Element, b: Element): Element => {
    let box: Element = a;
    while (!box.contains(b)) box = box.parentElement!;
    return box;
  };
  // While editing, the editor's field matches the title text too.
  const headerTitle = () =>
    screen
      .getAllByText('Weekend in Kyoto')
      .find((el) => el.tagName === 'SPAN')!;
  const precedes = (a: Element, b: Element) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  test('at rest it says Preview, above the session title', async () => {
    await renderPage();

    const label = screen.getByText('Preview');
    const title = headerTitle();
    expect(precedes(label, title)).toBe(true);
    expect(
      sharedBox(label, title).contains(
        screen.getByRole('button', { name: 'Edit' })
      )
    ).toBe(false);
    expect(screen.queryByText('Editing')).toBeNull();
  });

  test('while editing the same place says Editing, and the toolbar no longer does', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByText('Preview')).toBeNull();
    const labels = screen.getAllByText('Editing');
    expect(labels).toHaveLength(1);
    const title = headerTitle();
    expect(precedes(labels[0], title)).toBe(true);
    expect(
      sharedBox(labels[0], title).contains(
        screen.getByRole('button', { name: 'Done' })
      )
    ).toBe(false);
  });
});

describe('a window with no name in the editor (KAN-394)', () => {
  const UNNAMED = buildSession({
    ...SESSION,
    windows: [SESSION.windows[0], { ...SESSION.windows[1], title: '' }],
  });

  const renderUnnamed = () =>
    renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
      {
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([UNNAMED])));
        },
      }
    );

  test('its field is empty, shows the label as a placeholder, and is named by it', async () => {
    const user = userEvent.setup();
    await renderUnnamed();
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const field = screen.getByRole('textbox', {
      name: 'Rename window: Window 2',
    });
    expect(field).toHaveProperty('value', '');
    expect(field).toHaveAttribute('placeholder', 'Window 2');
    expect(
      screen.getByRole('button', { name: 'Hide: Window 2' })
    ).toBeInTheDocument();
  });

  test('a named window keeps its title and no placeholder', async () => {
    const user = userEvent.setup();
    await renderUnnamed();
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const field = screen.getByRole('textbox', {
      name: 'Rename window: Trip planning',
    });
    expect(field).toHaveProperty('value', 'Trip planning');
    expect(field).not.toHaveAttribute('placeholder');
    expect(
      screen.getByRole('button', { name: 'Hide: Trip planning' })
    ).toBeInTheDocument();
  });
});

// KAN-603. Each tab row in the editor shows the icon the file draws for it.
describe('the icons in Edit mode (KAN-603)', () => {
  const INARI = 'data:image/png;base64,SU5BUkk=';

  const renderEditor = (
    icons: ReadonlyMap<string, string>,
    scheme: ExportScheme = 'light',
    edits: ExportEdits = NO_EXPORT_EDITS
  ) =>
    renderWithProviders(
      <ExportEditor
        session={SESSION}
        edits={edits}
        scheme={scheme}
        icons={icons}
        onRename={() => {}}
        onToggleHidden={() => {}}
      />
    );

  const imageIn = (slot: HTMLElement): HTMLElement => {
    const image = slot.querySelector('img');
    if (!image) throw new Error('no icon image in the slot');
    return image;
  };

  const slots = () => [
    ...document.querySelectorAll<HTMLElement>('[data-icon-slot]'),
  ];

  test('every tab row has one slot, before its name field; group and window rows have none', async () => {
    await renderEditor(new Map());
    const tabFields = screen.getAllByRole('textbox', { name: /^Rename tab/ });

    expect(slots()).toHaveLength(tabFields.length);
    for (const field of tabFields) {
      const row = field.closest('li');
      expect(row?.querySelectorAll('[data-icon-slot]')).toHaveLength(1);
      expect(field.previousElementSibling?.hasAttribute('data-icon-slot')).toBe(
        true
      );
    }
    for (const slot of slots()) {
      expect(getComputedStyle(slot).width).toBe('16px');
    }
  });

  test('a cached icon shows as an image; a missing or bad one leaves the slot empty', async () => {
    await renderEditor(
      new Map([
        ['https://inari.jp/en/', INARI],
        ['https://jr.example/nozomi', 'javascript:alert(1)'],
      ])
    );
    const [inari, nozomi, apple] = slots();

    expect(inari.querySelector('img')?.getAttribute('src')).toBe(INARI);
    expect(inari.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(nozomi.querySelector('img')).toBeNull();
    expect(apple.querySelector('img')).toBeNull();
    expect(document.body.innerHTML).not.toContain('javascript:alert(1)');
  });

  test('a hidden row dims its icon with it', async () => {
    const window = SESSION.windows[0];
    await renderEditor(new Map([['https://inari.jp/en/', INARI]]), 'light', {
      titles: {},
      hidden: new Set([exportRowKey.tab(window, 't-1')]),
    });
    const [inari, nozomi] = slots();

    expect(inari.hasAttribute('data-dims')).toBe(true);
    expect(inari.closest('li')?.hasAttribute('data-hidden')).toBe(true);
    expect(nozomi.closest('li')?.hasAttribute('data-hidden')).toBe(false);
  });

  test('dark puts the icon on the plate; light has none', async () => {
    const icons = new Map([['https://inari.jp/en/', INARI]]);
    const { unmount } = await renderEditor(icons, 'dark');
    const dark = getComputedStyle(slots()[0]);
    const darkImage = getComputedStyle(imageIn(slots()[0]));
    expect(dark.backgroundColor).toBe('rgb(232, 234, 237)');
    expect(darkImage.width).toBe('14px');
    unmount();

    await renderEditor(icons, 'light');
    const light = getComputedStyle(slots()[0]);
    expect(EXPORT_PALETTE.light.iconPlate).toBe('transparent');
    expect(light.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(imageIn(slots()[0])).width).toBe('16px');
  });
});
