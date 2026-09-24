import { describe, expect, test, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import type { OpenNowHeaderAction } from '../../components/home/opennow/OpenNowPane';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { toOpenWindows } from '../../utils/functions/openNow';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { TAB_GROUP_COLOR_HEX } from '../../utils/functions/tabGroups';
// The saved window, rendered only to compare its band with the live one: the
// pane copies the declarations rather than sharing them (KAN-280).
import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';

// KAN-280 Part A, Task 4. The Open now pane's presentational half: it is
// handed `windows` and draws them. The hook that reads Chrome is Task 3's and
// the wiring is Task 5's, so these tests feed the pane directly -- but always
// through toOpenWindows, from the chrome fake, so every shape is one the real
// read can produce.

// jsdom runs inside Node, so `process` exists at runtime; tsconfig omits
// @types/node so app code cannot reach for it. The minimal shape the
// rejected-switch test needs, as permissions.test.ts declares it.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

// Two windows, three tabs. Window 2 holds B (inactive) and C (active), and is
// the one the pane is told it lives in. `pinned` and `audible` are seeded
// because the fake leaves them undefined otherwise.
const twoWindows = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [
        {
          title: 'A',
          url: 'https://a.test/',
          active: true,
          pinned: false,
          audible: false,
        },
      ],
    },
    {
      id: 2,
      focused: false,
      tabs: [
        {
          title: 'B',
          url: 'https://b.test/',
          active: false,
          pinned: false,
          audible: false,
        },
        {
          title: 'C',
          url: 'https://c.test/',
          active: true,
          pinned: false,
          audible: false,
        },
      ],
    },
  ],
});

// One window: a loose tab, then two tabs in the "Research" group.
const groupedWindow = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      tabs: [
        { title: 'Loose', url: 'https://loose.test/', pinned: false },
        {
          title: 'G1',
          url: 'https://g1.test/',
          pinned: false,
          groupId: 50,
        },
        {
          title: 'G2',
          url: 'https://g2.test/',
          pinned: false,
          groupId: 50,
        },
      ],
    },
  ],
  tabGroups: [{ id: 50, title: 'Research', color: 'blue', windowId: 1 }],
});

// Mounts the pane empty (null, the loading state), reads the fake the way the
// hook will, and hands the pane the result. Two steps because
// renderWithProviders is what installs the fake the read needs.
async function renderPane(
  seed: ChromeSeed,
  {
    thisWindowId = 2,
    groups = 'read',
    actions = [],
  }: {
    thisWindowId?: number | null;
    groups?: 'read' | 'none';
    actions?: OpenNowHeaderAction[];
  } = {}
) {
  const result = await renderWithProviders(
    <OpenNowPane
      windows={null}
      actions={actions}
      headingId="open-now-heading"
    />,
    { seed }
  );
  const windows = toOpenWindows(
    await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    groups === 'read' ? await chrome.tabGroups.query({}) : [],
    thisWindowId
  );
  result.rerender(
    <OpenNowPane
      windows={windows}
      actions={actions}
      headingId="open-now-heading"
    />
  );
  return { ...result, windows };
}

// A live band's colour strip.
const stripOf = (band: HTMLElement): HTMLElement => {
  const strip = band.querySelector('[data-open-now-group-strip]');
  if (!(strip instanceof HTMLElement)) throw new Error('band has no strip');
  return strip;
};

const tabRow = (title: string) =>
  screen.getByRole('button', { name: `Switch to tab: ${title}` });
const queryTabRow = (title: string) =>
  screen.queryByRole('button', { name: `Switch to tab: ${title}` });

// The block one window draws -- its row and its tabs.
const windowBlock = (name: string): HTMLElement => {
  const block = screen.getByText(name).closest('[data-open-window-id]');
  if (!(block instanceof HTMLElement)) {
    throw new Error(`no window block holds "${name}"`);
  }
  return block;
};

async function tabById(id: number): Promise<chrome.tabs.Tab | undefined> {
  const all = await chrome.windows.getAll({ populate: true });
  return all.flatMap((w) => w.tabs ?? []).find((tab) => tab.id === id);
}

async function windowById(
  id: number
): Promise<chrome.windows.Window | undefined> {
  const all = await chrome.windows.getAll({ populate: true });
  return all.find((w) => w.id === id);
}

function hex(value: string): string {
  const v = value.replace('#', '');
  const n = parseInt(v, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('the Open now pane (KAN-280)', () => {
  test('lists each window by number, tags this window, and shows every tab', async () => {
    await renderPane(twoWindows());

    expect(screen.getByText('Window 1')).toBeInTheDocument();
    expect(screen.getByText('Window 2')).toBeInTheDocument();

    // One tag, and on window 2 -- the id the pane was told it lives in.
    const tags = screen.getAllByText('This window');
    expect(tags).toHaveLength(1);
    expect(within(windowBlock('Window 2')).getByText('This window')).toBe(
      tags[0]
    );
    expect(
      within(windowBlock('Window 1')).queryByText('This window')
    ).toBeNull();

    for (const title of ['A', 'B', 'C']) {
      expect(tabRow(title)).toHaveTextContent(title);
    }
    expect(within(windowBlock('Window 1')).getByText('A')).toBeInTheDocument();
    expect(within(windowBlock('Window 2')).getByText('B')).toBeInTheDocument();
  });

  test('the header names the pane, counts windows and tabs, and says it is live', async () => {
    await renderPane(twoWindows());

    expect(screen.getByText('Open now')).toBeInTheDocument();
    expect(screen.getByText('2 Windows · 3 Tabs')).toBeInTheDocument();
    expect(screen.getByText('Updates as you browse')).toBeInTheDocument();
  });

  test('clicking a tab row activates that tab and focuses its window', async () => {
    const user = userEvent.setup();
    const { windows } = await renderPane(twoWindows());
    const b = windows[1]?.tabs[0];
    if (!b) throw new Error('seed has no tab B');

    // The premise: B is neither active nor in the focused window yet.
    expect((await tabById(b.id))?.active).toBe(false);
    expect((await windowById(2))?.focused).toBe(false);

    await user.click(tabRow('B'));

    await vi.waitFor(async () => {
      expect((await tabById(b.id))?.active).toBe(true);
      expect((await windowById(2))?.focused).toBe(true);
    });
  });

  // The worst path: the tab closes between the pane drawing it and the click.
  // Chrome rejects the switch; the pane swallows that rather than leak an
  // unhandled rejection, and the closed tab leaves the list on the next read.
  test('a switch Chrome rejects (the tab has closed) raises no unhandled rejection', async () => {
    const user = userEvent.setup();
    const { windows } = await renderPane(twoWindows());
    const b = windows[1]?.tabs[0];
    if (!b) throw new Error('seed has no tab B');

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const update = vi
      .spyOn(chrome.tabs, 'update')
      .mockRejectedValue(new Error(`No tab with id: ${b.id}.`));
    const focus = vi.spyOn(chrome.windows, 'update');

    try {
      await user.click(tabRow('B'));
      await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      // Let a rejection nobody handled reach the process.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(update).toHaveBeenCalledWith(b.id, { active: true });
      expect(focus).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
      expect(tabRow('B')).toBeInTheDocument();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  // Shade only: the title keeps the popup's one font weight, which
  // scaleConformance.test.ts holds (KAN-205).
  // The shade is colour alone; aria-current is the cue that is not. Each
  // window has one active tab, so one current row per window.
  test('the active tab of each window is marked current', async () => {
    await renderPane(twoWindows());

    const current = screen
      .getAllByRole('button', { current: true })
      .map((el) => el.ariaLabel);
    expect(current).toEqual(['Switch to tab: A', 'Switch to tab: C']);
    expect(tabRow('B')).not.toHaveAttribute('aria-current');
  });

  test('the active tab row is shaded', async () => {
    await renderPane(twoWindows());

    // C is window 2's active tab, B is not.
    const activeRow = tabRow('C').parentElement;
    const otherRow = tabRow('B').parentElement;
    if (!activeRow || !otherRow) throw new Error('tab row has no container');

    expect(getComputedStyle(activeRow).backgroundColor).toBe(
      hex(LIGHT_THEME.SECONDARY_COLOR)
    );
    expect(getComputedStyle(otherRow).backgroundColor).not.toBe(
      hex(LIGHT_THEME.SECONDARY_COLOR)
    );
  });

  test('a group draws its title once, above its tabs, in a band of its colour', async () => {
    await renderPane(groupedWindow(), { thisWindowId: 1 });

    const titles = screen.getAllByText('Research');
    expect(titles).toHaveLength(1);
    const title = titles[0];

    // Above both members, in document order.
    for (const member of ['G1', 'G2']) {
      expect(
        title.compareDocumentPosition(tabRow(member)) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }

    // The band holds the group's tabs and nothing else.
    const band = screen.getByRole('group', { name: 'Research' });
    expect(within(band).getByText('G1')).toBeInTheDocument();
    expect(within(band).getByText('G2')).toBeInTheDocument();
    expect(within(band).queryByText('Loose')).toBeNull();
    expect(getComputedStyle(stripOf(band)).backgroundColor).toBe(
      hex(TAB_GROUP_COLOR_HEX.blue)
    );
  });

  test('with no groups, no group title or band renders and every tab still does', async () => {
    await renderPane(groupedWindow(), { thisWindowId: 1, groups: 'none' });

    expect(screen.queryByText('Research')).toBeNull();
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    for (const title of ['Loose', 'G1', 'G2']) {
      expect(tabRow(title)).toBeInTheDocument();
    }
  });

  test('an empty list says no other tabs are open, and has no counts line', async () => {
    await renderWithProviders(
      <OpenNowPane windows={[]} actions={[]} headingId="open-now-heading" />
    );

    expect(screen.getByText('No other tabs are open')).toBeInTheDocument();
    expect(screen.getByText('Open now')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  test('while loading (null) there is no counts line and the body is empty', async () => {
    await renderWithProviders(
      <OpenNowPane windows={null} actions={[]} headingId="open-now-heading" />
    );

    expect(screen.getByText('Open now')).toBeInTheDocument();
    expect(screen.getByText('Updates as you browse')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).toBeNull();
    // Loading is not "nothing is open": the empty message waits for a read.
    expect(screen.queryByText('No other tabs are open')).toBeNull();
    expect(screen.queryByText(/^Window \d/)).toBeNull();
  });

  test('each header action renders a control named by its label, in order, and calls its own onClick', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    await renderPane(twoWindows(), {
      actions: [
        { icon: 'close', label: 'First action', onClick: first },
        { icon: 'tab', label: 'Second action', onClick: second },
      ],
    });

    const names = screen.getAllByRole('button').map((el) => el.ariaLabel);
    const firstIndex = names.indexOf('First action');
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(names.indexOf('Second action'));

    await user.click(screen.getByRole('button', { name: 'First action' }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Second action' }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  test('the collapse-all toggle hides every tab row, then shows them again', async () => {
    const user = userEvent.setup();
    await renderPane(twoWindows());

    await user.click(
      screen.getByRole('button', { name: 'Collapse all windows' })
    );
    for (const title of ['A', 'B', 'C']) {
      expect(queryTabRow(title)).toBeNull();
    }
    // The window rows stay; only their tabs fold.
    expect(screen.getByText('Window 1')).toBeInTheDocument();
    expect(screen.getByText('Window 2')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Expand all windows' })
    );
    for (const title of ['A', 'B', 'C']) {
      expect(queryTabRow(title)).toBeInTheDocument();
    }
  });

  test("collapsing one window hides only that window's tabs", async () => {
    const user = userEvent.setup();
    await renderPane(twoWindows());

    // Each chevron names its own window and says whether it is open, so N
    // windows are not N identical "Collapse" buttons.
    const chevron1 = screen.getByRole('button', {
      name: 'Collapse: Window 1',
    });
    expect(chevron1).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('button', { name: 'Collapse: Window 2' })
    ).toHaveAttribute('aria-expanded', 'true');

    await user.click(chevron1);

    expect(queryTabRow('A')).toBeNull();
    expect(queryTabRow('B')).toBeInTheDocument();
    expect(queryTabRow('C')).toBeInTheDocument();
    // Window 1's own chevron now offers the way back, and says it is shut.
    expect(
      screen.getByRole('button', { name: 'Expand: Window 1', expanded: false })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse: Window 2', expanded: true })
    ).toBeInTheDocument();
  });
});

// Two adjacent groups after a loose tab, the same in both panes: Research
// (blue, G1 G2) then Later (red, H1), so the second band is the "after a
// group" one (KAN-179).
const geometrySeed = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      tabs: [
        { title: 'Loose', url: 'https://loose.test/', pinned: false },
        { title: 'G1', url: 'https://g1.test/', pinned: false, groupId: 50 },
        { title: 'G2', url: 'https://g2.test/', pinned: false, groupId: 50 },
        { title: 'H1', url: 'https://h1.test/', pinned: false, groupId: 60 },
      ],
    },
  ],
  tabGroups: [
    { id: 50, title: 'Research', color: 'blue', windowId: 1 },
    { id: 60, title: 'Later', color: 'red', windowId: 1 },
  ],
});

async function renderSavedWindow() {
  return renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      tabs={[
        { tabId: 'l', favicon: '', title: 'Loose', url: 'https://loose.test/' },
        {
          tabId: 'g1',
          favicon: '',
          title: 'G1',
          url: 'https://g1.test/',
          chromeGroupId: 'R',
        },
        {
          tabId: 'g2',
          favicon: '',
          title: 'G2',
          url: 'https://g2.test/',
          chromeGroupId: 'R',
        },
        {
          tabId: 'h1',
          favicon: '',
          title: 'H1',
          url: 'https://h1.test/',
          chromeGroupId: 'L',
        },
      ]}
      chromeTabGroups={[
        { groupId: 'R', title: 'Research', color: 'blue' },
        { groupId: 'L', title: 'Later', color: 'red' },
      ]}
      onWindowTitleClick={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    { seedStore: (store) => store.dispatch(setHasTabGroupsPermission(true)) }
  );
}

// Reads the named computed properties into a plain object, so two elements
// can be compared with one toEqual that names the property that differs.
function stylesOf(el: Element, props: readonly string[]) {
  const cs = getComputedStyle(el);
  return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
}

const px = (value: string): number => Number.parseFloat(value) || 0;

// A border only takes room when it is drawn. jsdom reports the initial
// "medium" width (as 16px) on a box whose border-style is none, where a
// browser computes 0.
const borderPx = (cs: CSSStyleDeclaration, side: 'left' | 'right'): number =>
  ['', 'none', 'hidden'].includes(cs.getPropertyValue(`border-${side}-style`))
    ? 0
    : px(cs.getPropertyValue(`border-${side}-width`));

// The horizontal room a band's colour strip takes beside the content column:
// its width plus every margin, border and padding on it and on any wrapper
// between it and the band (the saved strip sits inside GroupColorPicker's two
// wrappers; the live one is the band's own child).
function stripFootprint(strip: Element, band: Element): number {
  let total = px(getComputedStyle(strip).width);
  for (
    let node: Element | null = strip;
    node && node !== band;
    node = node.parentElement
  ) {
    const cs = getComputedStyle(node);
    total +=
      px(cs.marginLeft) +
      px(cs.marginRight) +
      borderPx(cs, 'left') +
      borderPx(cs, 'right') +
      px(cs.paddingLeft) +
      px(cs.paddingRight);
  }
  return total;
}

// How far an element's content is pushed right by everything between it and
// its window block: each box's left margin, border and padding, plus, where
// the chain passes through a band, the strip's footprint beside the column.
// jsdom has no layout, so this adds up the declarations that make the offset
// instead of measuring it; Task 7's e2e measures the pixels.
function insetWithinWindow(
  el: Element,
  windowBlock: Element,
  band: Element,
  strip: Element
): number {
  let total = 0;
  for (
    let node: Element | null = el;
    node && node !== windowBlock;
    node = node.parentElement
  ) {
    const cs = getComputedStyle(node);
    total += px(cs.marginLeft) + borderPx(cs, 'left') + px(cs.paddingLeft);
    if (node.parentElement === band) total += stripFootprint(strip, band);
  }
  return total;
}

type BandGeometry = {
  band: Record<string, string>;
  afterGroupMarginTop: string;
  strip: Record<string, string>;
  column: Record<string, string>;
  titleRow: Record<string, string>;
  titleLabel: Record<string, string>;
  titleInset: number;
  stripFootprint: number;
  groupedTabInset: number;
  looseTabInset: number;
};

// The declarations that set where a band and its rows sit.
const BAND_PROPS = [
  'display',
  'align-items',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding-left',
  'padding-top',
  'padding-bottom',
  'border-left-style',
] as const;
const STRIP_PROPS = [
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'width',
  'margin-left',
  'margin-right',
  'align-self',
  'background-color',
] as const;
const COLUMN_PROPS = [
  'flex-grow',
  'flex-shrink',
  'min-width',
  'margin-left',
  'padding-left',
] as const;
const TITLE_ROW_PROPS = [
  'display',
  'align-items',
  'min-height',
  'margin-left',
  'padding-left',
] as const;
const TITLE_LABEL_PROPS = ['font-size', 'padding-left', 'color'] as const;

function readBandGeometry(
  firstBand: Element,
  secondBand: Element,
  strip: Element,
  titleRow: Element,
  windowBlock: Element,
  groupedTabContent: Element,
  looseTabContent: Element
): BandGeometry {
  const column = titleRow.parentElement;
  if (!column) throw new Error('title row has no column');
  const titleText = required(
    screen.getAllByText('Research').find((label) => titleRow.contains(label)) ??
      null,
    'title label inside the title row'
  );
  return {
    band: stylesOf(firstBand, BAND_PROPS),
    afterGroupMarginTop: getComputedStyle(secondBand).marginTop,
    strip: stylesOf(strip, STRIP_PROPS),
    column: stylesOf(column, COLUMN_PROPS),
    titleRow: stylesOf(titleRow, TITLE_ROW_PROPS),
    titleLabel: stylesOf(titleText, TITLE_LABEL_PROPS),
    titleInset: insetWithinWindow(titleText, windowBlock, firstBand, strip),
    stripFootprint: stripFootprint(strip, firstBand),
    groupedTabInset: insetWithinWindow(
      groupedTabContent,
      windowBlock,
      firstBand,
      strip
    ),
    looseTabInset: insetWithinWindow(
      looseTabContent,
      windowBlock,
      firstBand,
      strip
    ),
  };
}

// The first child of a tab row's button: the favicon, the first thing drawn.
function firstContentOf(button: HTMLElement): Element {
  const first = button.firstElementChild;
  if (!first) throw new Error('tab row button is empty');
  return first;
}

function required<T extends Element>(el: T | null, what: string): T {
  if (!el) throw new Error(`missing ${what}`);
  return el;
}

describe('the live group band matches the saved one (KAN-280)', () => {
  test('band, strip, title row and tab indent compute the same as a saved band', async () => {
    const saved = await renderSavedWindow();
    const savedBand = required(
      document.querySelector('[data-band-id="R"]'),
      'saved band R'
    );
    const savedStrip = required(
      savedBand.querySelector('[data-group-color-strip]'),
      'saved strip'
    );
    const savedStripStyle = getComputedStyle(savedStrip);
    const savedStripMargins = [
      savedStripStyle.marginTop,
      savedStripStyle.marginBottom,
    ];
    const savedGeometry = readBandGeometry(
      savedBand,
      required(document.querySelector('[data-band-id="L"]'), 'saved band L'),
      savedStrip,
      required(
        savedBand.querySelector('[data-group-drag-handle]'),
        'saved title row'
      ),
      required(
        document.querySelector('[data-drop-window-id]'),
        'saved window block'
      ),
      firstContentOf(
        screen.getByRole('button', { name: 'Open in new tab: G1' })
      ),
      firstContentOf(
        screen.getByRole('button', { name: 'Open in new tab: Loose' })
      )
    );
    saved.unmount();

    await renderPane(geometrySeed(), { thisWindowId: 1 });
    const liveBand = screen.getByRole('group', { name: 'Research' });
    const liveStrip = stripOf(liveBand);
    const liveGeometry = readBandGeometry(
      liveBand,
      screen.getByRole('group', { name: 'Later' }),
      liveStrip,
      required(
        liveStrip.nextElementSibling?.firstElementChild ?? null,
        'live title row'
      ),
      required(
        document.querySelector('[data-open-window-id]'),
        'live window block'
      ),
      firstContentOf(tabRow('G1')),
      firstContentOf(tabRow('Loose'))
    );

    // The saved strip's vertical margins are the drag's frame variables,
    // which jsdom leaves unresolved. Pinned apart: the saved source still
    // rests at 0 (their fallback), and the live strip is written as that 0.
    expect(savedStripMargins).toEqual([
      'var(--frame-top, 0px)',
      'calc(-1 * var(--frame-bottom, 0px))',
    ]);
    expect([
      getComputedStyle(liveStrip).marginTop,
      getComputedStyle(liveStrip).marginBottom,
    ]).toEqual(['0px', '0px']);

    expect(liveGeometry).toEqual(savedGeometry);

    // And the numbers themselves, so both drifting together cannot pass:
    // a 7px strip with a 9px gap (GroupColorPicker.tsx:101-104), and a
    // grouped tab 16px further in than a loose one.
    expect(liveGeometry.strip.width).toBe('7px');
    expect(liveGeometry.strip['margin-right']).toBe('9px');
    expect(liveGeometry.stripFootprint).toBe(16);
    expect(liveGeometry.groupedTabInset - liveGeometry.looseTabInset).toBe(16);
  });
});
