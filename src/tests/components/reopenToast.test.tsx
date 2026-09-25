import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import ru from '../../../public/locales/ru/translation.json';
import MainContainer from '../../components/MainContainer';
import { Toast } from '../../components/common/Toast';
import { offerReopen, REOPEN_TOAST_MS } from '../../redux/reopenOffer';
import { showToast } from '../../redux/slices/globalStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { toOpenWindows } from '../../utils/functions/openNow';
import type { OpenWindow } from '../../utils/functions/openNow';
import { closeOpenTab, closeOpenWindow } from '../../utils/functions/reopen';
import type { ClosedItem } from '../../utils/functions/reopen';
import type { ChromeSeed } from '../setup/chrome.fake';
import { initTestI18n, testI18n } from '../setup/i18nForTests';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-280 O8a. The toast after a close offers Reopen, and every toast is
// announced: the role="status" region is mounted before any text arrives,
// because a screen reader only hears changes to a live region it already
// knows about -- a region inserted along with its text is often silent.

beforeEach(async () => {
  await initTestI18n();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // The instance is shared, so a leaked locale would run later tests in it.
  await testI18n.changeLanguage('en');
});

const url = (name: string) => `https://${name}.test/`;

const tabKeeperWindow = {
  id: 1,
  focused: true,
  tabs: [{ url: url('home'), active: true }],
};

// Window 2 holds a and b; closing b leaves the window open.
const twoTabSeed: ChromeSeed = {
  windows: [
    tabKeeperWindow,
    { id: 2, tabs: [{ url: url('a') }, { url: url('b') }] },
  ],
};

// Read through toOpenWindows off the fake, never hand-built.
async function openWindow(id: number): Promise<OpenWindow> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const found = toOpenWindows(all, null, null).find((w) => w.id === id);
  if (!found) throw new Error(`no open window ${id}`);
  return found;
}

async function closeTabB(): Promise<ClosedItem> {
  const w2 = await openWindow(2);
  const b = w2.tabs.find((tab) => tab.url === url('b'));
  if (!b) throw new Error('no tab b');
  const item = await closeOpenTab(w2, b);
  if (!item) throw new Error('close failed');
  return item;
}

async function urlsIn(windowId: number): Promise<string[]> {
  return (await chrome.tabs.query({ windowId }))
    .sort((x, y) => x.index - y.index)
    .map((tab) => tab.url ?? '');
}

function visibleToast(): HTMLElement {
  const toast = screen.getByRole('status').firstElementChild;
  if (!(toast instanceof HTMLElement)) throw new Error('no visible toast');
  return toast;
}

describe('the Reopen toast (KAN-280 O8a)', () => {
  test('the toast region is always there, so a screen reader hears it when text arrives', async () => {
    const { store } = await renderWithProviders(<MainContainer />, {
      seed: twoTabSeed,
    });

    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');

    const item = await closeTabB();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });

    // The SAME node: a region swapped for a new one is a new region.
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toContain('Tab closed');
  });

  test('Reopen reopens the closed tab and closes the toast', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seed: twoTabSeed,
    });
    const item = await closeTabB();
    expect(await urlsIn(2)).toEqual([url('a')]);
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    });
    expect(store.getState().globalState.isToastOpen).toBe(false);
    expect(screen.queryByText('Tab closed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  // Rule 4. Both presses reach the handler: one act() holds React's
  // re-render until both have been dispatched, as a fast double click can.
  test('pressing Reopen twice reopens once', async () => {
    const { store, chrome: fake } = await renderWithProviders(<Toast />, {
      seed: twoTabSeed,
    });
    const item = await closeTabB();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    const button = screen.getByRole('button', { name: 'Reopen' });

    act(() => {
      button.click();
      button.click();
    });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    });
    expect(fake.createdTabs).toHaveLength(1);
  });

  test('a plain toast has no Reopen button', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seed: twoTabSeed,
    });
    const item = await closeTabB();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    // CONTROL: the offer did show a button, so its absence below is the
    // plain toast's doing.
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();

    await act(async () => {
      await store.dispatch(
        showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED })
      );
    });

    expect(screen.getByText(TOAST_MESSAGES.SYNC_MERGED)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  // Rule 10: nothing came back, and the toast says so.
  test('Reopen that brings nothing back says so', async () => {
    const { store, chrome: fake } = await renderWithProviders(<Toast />, {
      seed: { ...twoTabSeed, refusedUrls: [url('b')] },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const item = await closeTabB();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe("Couldn't reopen.");
    });
    // PREMISE: Chrome was asked and refused, rather than never asked.
    expect(fake.createdTabs).toHaveLength(1);
    expect(await urlsIn(2)).toEqual([url('a')]);
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  test('hovering or focusing the toast holds it open', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seed: twoTabSeed,
    });
    const item = await closeTabB();
    vi.useFakeTimers();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    const isOpen = () => store.getState().globalState.isToastOpen;

    // Hover at 1000ms, leave at 21000ms: 7000ms remain.
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.mouseEnter(visibleToast());
    act(() => vi.advanceTimersByTime(20_000));
    expect(isOpen()).toBe(true);
    fireEvent.mouseLeave(visibleToast());
    act(() => vi.advanceTimersByTime(6999));
    expect(isOpen()).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(isOpen()).toBe(false);

    // Focus holds it the same way.
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    const button = screen.getByRole('button', { name: 'Reopen' });
    act(() => button.focus());
    act(() => vi.advanceTimersByTime(REOPEN_TOAST_MS * 3));
    expect(isOpen()).toBe(true);
    act(() => button.blur());
    act(() => vi.advanceTimersByTime(REOPEN_TOAST_MS - 1));
    expect(isOpen()).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(isOpen()).toBe(false);
  });

  // The pointer leaving is not the end of the hold while focus is still in
  // the toast (a mouse press on Reopen puts it there): it holds while EITHER
  // is on it.
  test('the pointer leaving keeps it held while focus is still in it', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seed: twoTabSeed,
    });
    const item = await closeTabB();
    vi.useFakeTimers();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    const isOpen = () => store.getState().globalState.isToastOpen;

    fireEvent.mouseEnter(visibleToast());
    act(() => screen.getByRole('button', { name: 'Reopen' }).focus());
    fireEvent.mouseLeave(visibleToast());
    act(() => vi.advanceTimersByTime(REOPEN_TOAST_MS * 3));
    expect(isOpen()).toBe(true);
  });

  // Rule 3 replaces the toast on every close. A new offer arriving under the
  // pointer is still under the pointer, so it holds like the one it replaced.
  test('a new offer arriving under the pointer is held too', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seed: twoTabSeed,
    });
    const item = await closeTabB();
    vi.useFakeTimers();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    const isOpen = () => store.getState().globalState.isToastOpen;

    fireEvent.mouseEnter(visibleToast());
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    act(() => vi.advanceTimersByTime(REOPEN_TOAST_MS * 3));
    expect(isOpen()).toBe(true);

    fireEvent.mouseLeave(visibleToast());
    act(() => vi.advanceTimersByTime(REOPEN_TOAST_MS));
    expect(isOpen()).toBe(false);
  });

  // Pressing Reopen closes the toast under the pointer, and a removed element
  // gets no mouseleave. The next offer, wherever the pointer has gone, must
  // not inherit that hover and stay up for good.
  test('a toast closed under the pointer does not hold the next one', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seed: twoTabSeed,
    });
    const item = await closeTabB();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    fireEvent.mouseEnter(visibleToast());
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    });
    expect(store.getState().globalState.isToastOpen).toBe(false);

    vi.useFakeTimers();
    await act(async () => {
      await store.dispatch(offerReopen(await closeTabB()));
    });
    act(() => vi.advanceTimersByTime(REOPEN_TOAST_MS));
    expect(store.getState().globalState.isToastOpen).toBe(false);
  });

  // A blur whose focus lands elsewhere inside the toast is not focus leaving
  // it. The toast's own box stands in for "elsewhere inside".
  test('focus moving within the toast keeps it held', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seed: twoTabSeed,
    });
    const item = await closeTabB();
    vi.useFakeTimers();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    const isOpen = () => store.getState().globalState.isToastOpen;

    const button = screen.getByRole('button', { name: 'Reopen' });
    act(() => button.focus());
    fireEvent.focusOut(button, { relatedTarget: visibleToast() });
    act(() => vi.advanceTimersByTime(REOPEN_TOAST_MS * 3));
    expect(isOpen()).toBe(true);

    // CONTROL: focus leaving for outside the toast does release it.
    fireEvent.focusOut(button, { relatedTarget: document.body });
    act(() => vi.advanceTimersByTime(REOPEN_TOAST_MS));
    expect(isOpen()).toBe(false);
  });

  test('a plain toast is not held by hovering', async () => {
    const { store } = await renderWithProviders(<Toast />);
    vi.useFakeTimers();
    await act(async () => {
      await store.dispatch(
        showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED })
      );
    });

    fireEvent.mouseEnter(visibleToast());
    act(() => vi.advanceTimersByTime(5000));
    expect(store.getState().globalState.isToastOpen).toBe(false);
  });

  // KAN-280 O8b. At 300px the count was cut off in 8 of 13 locales, so a
  // toast offering Reopen is as wide as its one line, from 300 to 460px. jsdom
  // cannot lay text out: the widths themselves are measured in
  // e2e/open-now-close.spec.ts. This pins only the rule that differs.
  test('the Reopen toast sizes to its line, 300 to 460px; a plain toast stays 300px', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seed: twoTabSeed,
    });
    await act(async () => {
      await store.dispatch(
        showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED })
      );
    });
    // CONTROL: the plain toast's fixed width reads here, so its absence on
    // the Reopen toast below is not a blind read.
    expect(visibleToast()).toHaveStyle({ width: '300px' });

    const item = await closeTabB();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    const toast = visibleToast();
    // PREMISE: this is the Reopen toast.
    expect(toast).toContainElement(
      screen.getByRole('button', { name: 'Reopen' })
    );
    expect(toast).not.toHaveStyle({ width: '300px' });
    // jsdom resolves the min() against its 1024px window, so the cap reads
    // as the 460px that wins there.
    expect(toast).toHaveStyle({
      width: 'max-content',
      minWidth: '300px',
      maxWidth: '460px',
    });
  });

  test('ru counts: 1, 2 and 5 tabs read in the right plural', async () => {
    const seed: ChromeSeed = {
      windows: [
        tabKeeperWindow,
        { id: 2, tabs: [{ url: url('a') }] },
        { id: 3, tabs: ['a', 'b'].map((n) => ({ url: url(n) })) },
        {
          id: 4,
          tabs: ['a', 'b', 'c', 'd', 'e'].map((n) => ({ url: url(n) })),
        },
      ],
    };
    const { store } = await renderWithProviders(<Toast />, { seed });
    testI18n.addResourceBundle('ru', 'translation', ru, true, true);
    await act(async () => {
      await testI18n.changeLanguage('ru');
    });
    // CONTROL: without this, every assertion below could be passing in English.
    expect(testI18n.language).toBe('ru');

    const expected: [number, string][] = [
      [2, ru.WindowClosed_one.replace('{{count}}', '1')],
      [3, ru.WindowClosed_few.replace('{{count}}', '2')],
      [4, ru.WindowClosed_many.replace('{{count}}', '5')],
    ];
    for (const [windowId, text] of expected) {
      const item = await closeOpenWindow(await openWindow(windowId));
      if (!item) throw new Error(`close of window ${windowId} failed`);
      await act(async () => {
        await store.dispatch(offerReopen(item));
      });
      const shown = visibleToast().textContent ?? '';
      expect(shown).toContain(text);
      expect(shown).toContain(ru.Reopen);
    }
    // The three forms really differ, so one wrong pick cannot pass as another.
    expect(new Set(expected.map(([, text]) => text)).size).toBe(3);
  });
});
