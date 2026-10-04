import { afterEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';

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
