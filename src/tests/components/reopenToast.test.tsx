import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import de from '../../../public/locales/de/translation.json';
import ru from '../../../public/locales/ru/translation.json';
import MainContainer from '../../components/MainContainer';
import { Toast } from '../../components/common/Toast';
import { offerReopen, REOPEN_TOAST_MS } from '../../redux/reopenOffer';
import {
  openSettingsPage,
  showToast,
} from '../../redux/slices/globalStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { toOpenWindows } from '../../utils/functions/openNow';
import type { OpenWindow } from '../../utils/functions/openNow';
import { closeOpenTab, closeOpenWindow } from '../../utils/functions/reopen';
import { clearReopenFocus } from '../../redux/reopenFocus';
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
  clearReopenFocus();
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

// KAN-311 (O8c). While the Reopen toast shows, ⌘Z on a Mac and Ctrl+Z
// elsewhere takes the offer, exactly as pressing Reopen does, and does not
// undo a saved-session edit. The handler treats ctrl and meta alike, as it
// always has for undo.
describe('the ⌘Z / Ctrl+Z key reopens while the toast shows (KAN-311)', () => {
  const UNDO = 'undoRedo/undo';
  const REDO = 'undoRedo/redo';

  // Dispatched rather than typed: the listener is on `window`, and the event
  // carries its target, as a real keypress does.
  function press(
    target: EventTarget,
    chord: {
      key: string;
      ctrlKey?: boolean;
      metaKey?: boolean;
      shiftKey?: boolean;
      repeat?: boolean;
    }
  ): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...chord,
    });
    target.dispatchEvent(event);
    return event;
  }

  async function withOffer() {
    const rendered = await renderWithProviders(<MainContainer />, {
      seed: twoTabSeed,
    });
    const item = await closeTabB();
    await act(async () => {
      await rendered.store.dispatch(offerReopen(item));
    });
    // PREMISE: the Reopen toast is up.
    expect(
      within(screen.getByRole('status')).getByRole('button', {
        name: 'Reopen',
      })
    ).toBeTruthy();
    return rendered;
  }

  const undoRedoIn = (seen: string[]) =>
    seen.filter((type) => type === UNDO || type === REDO);

  test('Ctrl+Z takes the offer and does not undo', async () => {
    const { store, seen } = await withOffer();
    const before = seen.length;

    let event: KeyboardEvent | undefined;
    act(() => {
      event = press(document.body, { key: 'z', ctrlKey: true });
    });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
    expect(store.getState().globalState.isToastOpen).toBe(false);
  });

  test('⌘Z takes it too', async () => {
    const { seen } = await withOffer();
    const before = seen.length;

    act(() => {
      press(document.body, { key: 'z', metaKey: true });
    });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    });
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });

  test('CONTROL: with no toast showing, the same key undoes', async () => {
    const { seen, chrome: fake } = await renderWithProviders(
      <MainContainer />,
      { seed: twoTabSeed }
    );
    const before = seen.length;

    let event: KeyboardEvent | undefined;
    act(() => {
      event = press(document.body, { key: 'z', ctrlKey: true });
    });

    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
    expect(event?.defaultPrevented).toBe(true);
    expect(fake.createdTabs).toEqual([]);
  });

  // The slice leaves toastReopenOfferId set when a toast closes, so an offer
  // that has timed out must not keep the key from undoing.
  test('once the offer has timed out, the key undoes again', async () => {
    const {
      store,
      seen,
      chrome: fake,
    } = await renderWithProviders(<MainContainer />, { seed: twoTabSeed });
    const item = await closeTabB();
    vi.useFakeTimers();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    act(() => vi.advanceTimersByTime(REOPEN_TOAST_MS));
    // PREMISE: the toast has gone, and the slice still names the offer.
    expect(store.getState().globalState.isToastOpen).toBe(false);
    expect(store.getState().globalState.toastReopenOfferId).not.toBeNull();
    const before = seen.length;

    act(() => {
      press(document.body, { key: 'z', ctrlKey: true });
    });

    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
    expect(fake.createdTabs).toEqual([]);
  });

  test('redo while the offer shows redoes and keeps the toast', async () => {
    const { store, seen } = await withOffer();
    const before = seen.length;

    act(() => {
      press(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    });

    expect(undoRedoIn(seen.slice(before))).toEqual([REDO]);
    expect(store.getState().globalState.isToastOpen).toBe(true);
    expect(
      within(screen.getByRole('status')).getByRole('button', {
        name: 'Reopen',
      })
    ).toBeTruthy();
  });

  test('CONTROL: undo and redo still close a plain toast', async () => {
    const { store } = await renderWithProviders(<MainContainer />, {
      seed: twoTabSeed,
    });
    for (const chord of [
      { key: 'z', ctrlKey: true },
      { key: 'Z', ctrlKey: true, shiftKey: true },
    ]) {
      await act(async () => {
        await store.dispatch(
          showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED })
        );
      });
      expect(store.getState().globalState.isToastOpen).toBe(true);

      act(() => {
        press(document.body, chord);
      });

      expect(store.getState().globalState.isToastOpen).toBe(false);
    }
  });

  // KAN-52: inside a text field the key is the field's own undo.
  test('in a text field the key is left to the field', async () => {
    const { store, seen, chrome: fake } = await withOffer();
    const input = document.createElement('input');
    document.body.append(input);
    const before = seen.length;

    let event: KeyboardEvent | undefined;
    act(() => {
      event = press(input, { key: 'z', ctrlKey: true });
    });
    input.remove();

    expect(event?.defaultPrevented).toBe(false);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
    expect(fake.createdTabs).toEqual([]);
    expect(store.getState().globalState.isToastOpen).toBe(true);
  });

  // Rule 4, by key: two presses before React re-renders -- a fast double
  // tap -- take the offer once, and the second does not fall through to an
  // undo either. A held key's repeats, which arrive after the re-render, are
  // the next describe's.
  test('two presses take the offer once and undo nothing', async () => {
    const { seen, chrome: fake } = await withOffer();
    const before = seen.length;

    act(() => {
      press(document.body, { key: 'z', ctrlKey: true });
      press(document.body, { key: 'z', ctrlKey: true });
    });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    });
    expect(fake.createdTabs).toHaveLength(1);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });

  // A held ⌘Z / Ctrl+Z: the first press takes the offer, and its repeats,
  // arriving once the toast has gone, must not go on to undo saved-session
  // edits. The hold ends on the Z keyup, on the modifier's keyup (macOS
  // Chrome sends no Z keyup while ⌘ is down), or on any fresh press.
  describe('a held key', () => {
    function release(key: string): void {
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent('keyup', { bubbles: true, key })
        );
      });
    }

    async function offerTakenByKey() {
      const rendered = await withOffer();
      act(() => {
        press(document.body, { key: 'z', metaKey: true });
      });
      await waitFor(async () => {
        expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
      });
      // PREMISE: the toast has gone and re-rendered away, so the handler
      // itself no longer sees an offer.
      expect(rendered.store.getState().globalState.isToastOpen).toBe(false);
      expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
      return rendered;
    }

    test('its repeats undo nothing', async () => {
      const { seen } = await offerTakenByKey();
      const before = seen.length;

      let event: KeyboardEvent | undefined;
      act(() => {
        event = press(document.body, {
          key: 'z',
          metaKey: true,
          repeat: true,
        });
        press(document.body, { key: 'z', metaKey: true, repeat: true });
      });

      expect(undoRedoIn(seen.slice(before))).toEqual([]);
      expect(event?.defaultPrevented).toBe(true);
    });

    test('CONTROL: let go, a fresh press undoes', async () => {
      const { seen } = await offerTakenByKey();
      release('z');
      release('Meta');
      const before = seen.length;

      act(() => {
        press(document.body, { key: 'z', metaKey: true });
      });

      expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
    });

    test('⌘ let go with no Z keyup, as macOS sends it: a fresh press undoes', async () => {
      const { seen } = await offerTakenByKey();
      release('Meta');
      const before = seen.length;

      act(() => {
        press(document.body, { key: 'z', metaKey: true });
      });

      expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
    });

    // Each way out, on its own: after it, a repeat is an ordinary undo
    // again, so the hold cannot stick.
    test.each([
      ['Z let go', () => release('z')],
      ['⌘ let go', () => release('Meta')],
      ['Ctrl let go', () => release('Control')],
      [
        'another key pressed',
        () =>
          act(() => {
            press(document.body, { key: 'Shift' });
          }),
      ],
    ])('%s ends the hold', async (_, endHold) => {
      const { seen } = await offerTakenByKey();
      endHold();
      const before = seen.length;

      act(() => {
        press(document.body, { key: 'z', ctrlKey: true, repeat: true });
      });

      expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
    });
  });
});

// KAN-311 (O8c). The Reopen button shows its key: ⌘Z on a Mac, Ctrl+Z (the
// modifier's word translated) anywhere else. The hint is hidden from the
// accessible name, which stays "Reopen"; aria-keyshortcuts carries the key.
describe('the Reopen button shows its key (KAN-311)', () => {
  async function reopenButtonWith(seed: ChromeSeed) {
    const { store } = await renderWithProviders(<Toast />, { seed });
    const item = await closeTabB();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    return within(screen.getByRole('status')).getByRole('button', {
      name: testI18n.t('Reopen'),
    });
  }

  test('⌘Z on a Mac', async () => {
    const button = await reopenButtonWith({ ...twoTabSeed, platformOs: 'mac' });
    await waitFor(() => expect(button).toHaveTextContent('⌘Z'));
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+Z');
    expect(button).not.toHaveTextContent('Ctrl');
  });

  test('Ctrl+Z on Windows', async () => {
    const button = await reopenButtonWith({ ...twoTabSeed, platformOs: 'win' });
    // Given time to arrive, so a Mac hint arriving late would show here.
    await act(async () => {
      await chrome.runtime.getPlatformInfo();
    });
    expect(button).toHaveTextContent('Ctrl+Z');
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+Z');
    expect(button).not.toHaveTextContent('⌘');
  });

  test('de: Strg+Z', async () => {
    const button = await reopenButtonWith({
      ...twoTabSeed,
      platformOs: 'linux',
    });
    // CONTROL: English first, so the German below is the switch's doing.
    expect(button).toHaveTextContent('ReopenCtrl+Z');
    testI18n.addResourceBundle('de', 'translation', de, true, true);
    await act(async () => {
      await testI18n.changeLanguage('de');
    });
    expect(testI18n.language).toBe('de');
    expect(de.Ctrl).toBe('Strg');

    expect(button).toHaveTextContent(`${de.Reopen}Strg+Z`);
  });

  test('the accessible name stays "Reopen"', async () => {
    const button = await reopenButtonWith({ ...twoTabSeed, platformOs: 'mac' });
    await waitFor(() => expect(button).toHaveTextContent('⌘Z'));
    expect(button).toHaveAccessibleName('Reopen');
  });

  // The key does nothing on the settings page, so neither does its hint:
  // the button stays, without the key.
  test('on the settings page the hint is hidden and the button stays', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seed: { ...twoTabSeed, platformOs: 'mac' },
    });
    const item = await closeTabB();
    await act(async () => {
      await store.dispatch(offerReopen(item));
    });
    const reopen = () =>
      within(screen.getByRole('status')).getByRole('button', {
        name: 'Reopen',
      });
    // CONTROL: off the settings page the hint shows.
    await waitFor(() => expect(reopen()).toHaveTextContent('⌘Z'));

    await act(async () => {
      await store.dispatch(openSettingsPage(undefined));
    });

    expect(store.getState().globalState.isSettingsPage).toBe(true);
    expect(reopen().querySelector('[data-key-hint]')).toBeNull();
    expect(reopen()).not.toHaveTextContent('⌘Z');
    expect(reopen()).not.toHaveAttribute('aria-keyshortcuts');
  });

  // Until Chrome answers, and if it never does, the hint is the Ctrl form:
  // the form for most platforms, and never a ⌘ on a keyboard without one.
  // Seeded as a Mac, so a hint read from the platform would be ⌘Z.
  test('Ctrl+Z while the platform is unknown, and if reading it fails', async () => {
    for (const answer of ['never', 'reject'] as const) {
      const { store, rerender, unmount } = await renderWithProviders(
        <Toast key="before" />,
        { seed: { ...twoTabSeed, platformOs: 'mac' } }
      );
      vi.spyOn(chrome.runtime, 'getPlatformInfo').mockImplementation(() =>
        answer === 'never'
          ? new Promise<chrome.runtime.PlatformInfo>(() => {})
          : Promise.reject(new Error('no platform'))
      );
      // A fresh Toast, so it reads the platform through the spy.
      rerender(<Toast key="after" />);
      const item = await closeTabB();
      await act(async () => {
        await store.dispatch(offerReopen(item));
      });
      const button = within(screen.getByRole('status')).getByRole('button', {
        name: 'Reopen',
      });

      expect(chrome.runtime.getPlatformInfo).toHaveBeenCalled();
      expect(button, answer).toHaveTextContent('Ctrl+Z');
      expect(button, answer).toHaveAttribute('aria-keyshortcuts', 'Control+Z');
      unmount();
      vi.restoreAllMocks();
    }
  });
});
