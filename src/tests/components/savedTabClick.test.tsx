import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { runShownHere } from '../../redux/slices/globalStateSlice';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { newRun } from '../../utils/functions/firstRun';

// KAN-884. A saved tab's plain click switches to an open copy, else opens one;
// middle-click and ⌘/Ctrl-click open a copy in the background; the menu's
// Open in new tab opens a copy in front.

const TABS: tabData[] = [
  { tabId: 't1', favicon: '', title: 'Open one', url: 'https://a.test/' },
  { tabId: 't2', favicon: '', title: 'Closed one', url: 'https://b.test/' },
];

// Tab Keeper's window 1 in front; window 2 holds a copy of t1, not in front.
const seed = (platformOs: 'mac' | 'linux' = 'linux'): ChromeSeed => ({
  platformOs,
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [{ id: 10, url: 'https://here.test/', active: true }],
    },
    {
      id: 2,
      focused: false,
      tabs: [
        { id: 20, url: 'https://other.test/', active: true },
        { id: 21, url: 'https://a.test/' },
      ],
    },
  ],
});

afterEach(() => {
  vi.restoreAllMocks();
});

// KAN-413. A tour on its sample blocks every open from it.
const SAMPLE = 'sample:x';

async function renderSaved(
  platformOs: 'mac' | 'linux' = 'linux',
  { tour = false } = {}
) {
  const r = await renderWithProviders(
    <WindowEntryContainer
      number={1}
      title="Window 1"
      tabGroupId={tour ? SAMPLE : 'tg1'}
      windowId="w1"
      tabs={TABS}
      onOpenWindow={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seed: seed(platformOs),
      seedStore: (store) => {
        if (!tour) return;
        store.dispatch(
          recordFirstRun({ ...newRun('popup', 6), sessionId: SAMPLE })
        );
        store.dispatch(runShownHere());
      },
    }
  );
  // The platform answer and the fake's chrome calls settle on later tasks.
  await settle();
  return r;
}

const settle = () =>
  act(() => new Promise<void>((done) => setTimeout(done, 0)));

const row = (title: string) =>
  screen.getByRole('button', { name: `Open in new tab: ${title}` });

const activeIn = async (windowId: number) =>
  (await chrome.tabs.query({ active: true, windowId }))[0]?.id;

const focusedWindow = async () => (await chrome.windows.getLastFocused()).id;

describe('a plain click', () => {
  test('switches to the open copy in another window and focuses it; opens nothing', async () => {
    const r = await renderSaved();

    fireEvent.click(row('Open one'));

    await vi.waitFor(async () => expect(await activeIn(2)).toBe(21));
    expect(await focusedWindow()).toBe(2);
    await settle();
    expect(r.chrome.createdTabs).toEqual([]);
  });

  test('opens a new tab in front, beside the active one, when no copy is open', async () => {
    const r = await renderSaved();

    fireEvent.click(row('Closed one'));

    await vi.waitFor(() => expect(r.chrome.createdTabs).toHaveLength(1));
    expect(r.chrome.createdTabs[0]).toMatchObject({
      url: 'https://b.test/',
      active: true,
      index: 1,
    });
    expect(await activeIn(2)).toBe(20);
  });
});

describe('a new copy in the background', () => {
  const expectBackgroundCopy = async (
    r: Awaited<ReturnType<typeof renderSaved>>
  ) => {
    await vi.waitFor(() => expect(r.chrome.createdTabs).toHaveLength(1));
    expect(r.chrome.createdTabs[0]).toMatchObject({
      url: 'https://a.test/',
      active: false,
      index: 1,
    });
    // Never switches: the open copy stays behind, window 1 stays in front.
    expect(await activeIn(1)).toBe(10);
    expect(await activeIn(2)).toBe(20);
    expect(await focusedWindow()).toBe(1);
  };

  test('middle-click, even with a copy open', async () => {
    const r = await renderSaved();

    fireEvent(
      row('Open one'),
      new MouseEvent('auxclick', { bubbles: true, button: 1 })
    );

    await expectBackgroundCopy(r);
  });

  test('a middle press does not start autoscroll', async () => {
    await renderSaved();
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 1,
    });

    row('Open one').dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
  });

  test('a right-button auxclick opens nothing (the menu has it)', async () => {
    const r = await renderSaved();

    fireEvent(
      row('Open one'),
      new MouseEvent('auxclick', { bubbles: true, button: 2 })
    );

    await settle();
    expect(r.chrome.createdTabs).toEqual([]);
  });

  test('⌘-click on a Mac', async () => {
    const r = await renderSaved('mac');

    fireEvent.click(row('Open one'), { metaKey: true });

    await expectBackgroundCopy(r);
  });

  test('Ctrl-click off a Mac', async () => {
    const r = await renderSaved('linux');

    fireEvent.click(row('Open one'), { ctrlKey: true });

    await expectBackgroundCopy(r);
  });

  test('CONTROL: Ctrl-click on a Mac is the context menu, never an open', async () => {
    const r = await renderSaved('mac');

    fireEvent.mouseDown(row('Open one'), { button: 0, ctrlKey: true });
    fireEvent.click(row('Open one'), { ctrlKey: true });

    await settle();
    expect(r.chrome.createdTabs).toEqual([]);
    expect(await activeIn(2)).toBe(20);
  });
});

describe('the menu’s Open in new tab', () => {
  test('opens a new copy in front, even with a copy open', async () => {
    const r = await renderSaved();

    fireEvent.contextMenu(row('Open one'));
    const menu = document.querySelector<HTMLElement>('[data-row-menu]');
    if (!menu) throw new Error('no row menu');
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: /^Open in new tab/ })
    );

    await vi.waitFor(() => expect(r.chrome.createdTabs).toHaveLength(1));
    expect(r.chrome.createdTabs[0]).toMatchObject({
      url: 'https://a.test/',
      active: true,
    });
    expect(await activeIn(2)).toBe(20);
  });
});

describe('while the tour blocks opens (KAN-413)', () => {
  test.each(['mac', 'linux'] as const)(
    'on %s, middle-click and ⌘/Ctrl-click open and switch nothing',
    async (os) => {
      const r = await renderSaved(os, { tour: true });
      const blocked = row('Open one');
      expect(blocked).toHaveAttribute('aria-disabled', 'true');

      fireEvent(
        blocked,
        new MouseEvent('auxclick', { bubbles: true, button: 1 })
      );
      fireEvent.click(
        blocked,
        os === 'mac' ? { metaKey: true } : { ctrlKey: true }
      );
      fireEvent.click(blocked);

      await settle();
      expect(r.chrome.createdTabs).toEqual([]);
      expect(await activeIn(2)).toBe(20);
      expect(await focusedWindow()).toBe(1);
    }
  );
});
