import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import {
  NEW_WINDOW_FOLLOW_MS,
  clearNewWindowFollow,
  expectNewWindow,
} from '../../redux/newWindowFollow';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-852. A copy opened in a new window from Currently open: once a re-read
// lists the window, it is scrolled into view. jsdom has no layout, so this
// holds which block is asked to scroll and how; e2e saved-into-open-now
// measures that it ends whole on screen.

const tab = (id: number, title: string) => ({
  id,
  title,
  url: `https://${title.toLowerCase()}.test/`,
});
const twoWindows = (): ChromeSeed => ({
  windows: [
    { id: 1, focused: true, tabs: [tab(11, 'A'), tab(12, 'B')] },
    { id: 2, tabs: [tab(21, 'C')] },
  ],
});

let scrolled: { windowId: string | null; options: unknown }[] = [];
beforeEach(() => {
  scrolled = [];
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
    this: Element,
    options?: boolean | ScrollIntoViewOptions
  ) {
    scrolled.push({
      windowId: this.getAttribute('data-open-window-id'),
      options,
    });
  });
});
afterEach(() => {
  clearNewWindowFollow();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function renderOpenNow() {
  const rendered = await renderWithProviders(<OpenNowColumn folded={true} />, {
    seed: twoWindows(),
    // Groups are listed with the grant only.
    seedStore: (store) => store.dispatch(setHasTabGroupsPermission(true)),
  });
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return rendered;
}

const openWindow = () =>
  act(async () => {
    await chrome.windows.create({ url: 'https://new.test/', focused: false });
  });

const windowsScrolled = () =>
  scrolled.filter((s) => s.windowId !== null).map((s) => s.windowId);

describe('a new window from Currently open (KAN-852)', () => {
  test('once listed, it is scrolled into view, to its nearest edge', async () => {
    await renderOpenNow();
    act(() => expectNewWindow());

    await openWindow();

    await waitFor(() => expect(windowsScrolled()).toHaveLength(1));
    const [only] = scrolled.filter((s) => s.windowId !== null);
    expect(only?.windowId).not.toMatch(/^[12]$/);
    expect(only?.options).toEqual({ block: 'nearest' });
  });

  test('once only: a second new window is not followed', async () => {
    await renderOpenNow();
    act(() => expectNewWindow());
    await openWindow();
    await waitFor(() => expect(windowsScrolled()).toHaveLength(1));

    await openWindow();
    await waitFor(() =>
      expect(document.querySelectorAll('[data-open-window-id]')).toHaveLength(4)
    );

    expect(windowsScrolled()).toHaveLength(1);
  });

  // A restored window is made with one tab, and the rest are added after.
  test('followed again as it gains tabs, and not when a re-read leaves it as it was', async () => {
    const rendered = await renderOpenNow();
    act(() => expectNewWindow());
    let made = -1;
    await act(async () => {
      made =
        (await chrome.windows.create({ url: 'https://new.test/' }))?.id ?? -1;
    });
    await waitFor(() => expect(windowsScrolled()).toEqual([String(made)]));

    await act(async () => {
      await chrome.tabs.create({ windowId: made, url: 'https://more.test/' });
    });
    await waitFor(() =>
      expect(windowsScrolled()).toEqual([String(made), String(made)])
    );
    act(() => rendered.chrome.browser.updateTab(11, { title: 'A2' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Switch to tab: A2' })
      ).toBeTruthy()
    );

    expect(windowsScrolled()).toEqual([String(made), String(made)]);
  });

  // A restore forms its groups after its tabs: each band is a row more.
  test('followed again when it forms a group', async () => {
    await renderOpenNow();
    act(() => expectNewWindow());
    let made = -1;
    let tabs: number[] = [];
    await act(async () => {
      const w = await chrome.windows.create({
        url: ['https://new.test/', 'https://more.test/'],
      });
      made = w?.id ?? -1;
      tabs = (w?.tabs ?? []).map((t) => t.id ?? -1);
    });
    await waitFor(() => expect(windowsScrolled()).toEqual([String(made)]));

    const [first, ...rest] = tabs;
    if (first === undefined) throw new Error('no tabs made');
    await act(async () => {
      await chrome.tabs.group({
        tabIds: [first, ...rest],
        createProperties: { windowId: made },
      });
    });

    await waitFor(() =>
      expect(windowsScrolled()).toEqual([String(made), String(made)])
    );
  });

  test('CONTROL: a new window nobody asked for is not followed', async () => {
    await renderOpenNow();

    await openWindow();
    await waitFor(() =>
      expect(document.querySelectorAll('[data-open-window-id]')).toHaveLength(3)
    );

    expect(windowsScrolled()).toEqual([]);
  });

  test(`a window listed after ${NEW_WINDOW_FOLLOW_MS}ms is not followed`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderOpenNow();
    act(() => expectNewWindow());

    act(() => vi.advanceTimersByTime(NEW_WINDOW_FOLLOW_MS));
    await openWindow();
    await waitFor(() =>
      expect(document.querySelectorAll('[data-open-window-id]')).toHaveLength(3)
    );

    expect(windowsScrolled()).toEqual([]);
  });
});
