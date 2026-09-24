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
    <OpenNowPane windows={null} actions={actions} />,
    { seed }
  );
  const windows = toOpenWindows(
    await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    groups === 'read' ? await chrome.tabGroups.query({}) : [],
    thisWindowId
  );
  result.rerender(<OpenNowPane windows={windows} actions={actions} />);
  return { ...result, windows };
}

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
    expect(getComputedStyle(band).borderLeft).toBe(
      `4px solid ${hex(TAB_GROUP_COLOR_HEX.blue)}`
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
    await renderWithProviders(<OpenNowPane windows={[]} actions={[]} />);

    expect(screen.getByText('No other tabs are open')).toBeInTheDocument();
    expect(screen.getByText('Open now')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  test('while loading (null) there is no counts line and the body is empty', async () => {
    await renderWithProviders(<OpenNowPane windows={null} actions={[]} />);

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

    await user.click(
      within(windowBlock('Window 1')).getByRole('button', { name: 'Collapse' })
    );

    expect(queryTabRow('A')).toBeNull();
    expect(queryTabRow('B')).toBeInTheDocument();
    expect(queryTabRow('C')).toBeInTheDocument();
    // Window 1's own chevron now offers the way back.
    expect(
      within(windowBlock('Window 1')).getByRole('button', { name: 'Expand' })
    ).toBeInTheDocument();
  });
});
