import { createRef } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  markClosesThisTabCardAnswered,
  setDefaultView,
} from '../../redux/slices/settingsDataStateSlice';
import { RETURN_FROM_FULL_VIEW_MESSAGE } from '../../utils/functions/backFromFullView';
import { OPEN_IN_POPUP_MESSAGE } from '../../utils/functions/openInPopup';
import { fullViewOriginKey } from '../../utils/functions/fullViewOrigin';
import type { DefaultView } from '../../utils/functions/defaultView';

// KAN-578 (pick A, wording 2, H1). A press that would close this full view asks first, until Go back or a Pin that worked.

const BACK_TEXT = 'Going back closes this tab. Pin it to keep it open.';
const COMPACT_TEXT =
  'Opening compact view closes this tab. Pin it to keep it open.';

const fullViewTab = (pinned = false) => ({
  id: 7,
  url: 'chrome-extension://x/index.html?view=tab',
  active: true,
  pinned,
});

// The full view is tab 7 in window 1, beside tab 6, which it was opened from.
const seedFor = (pinned = false): ChromeSeed => ({
  action: {},
  currentTabId: 7,
  windows: [
    { id: 1, tabs: [{ id: 6, url: 'https://a.test/' }, fullViewTab(pinned)] },
  ],
  sessionArea: {
    [fullViewOriginKey(1)]: { fullViewTabId: 7, originTabId: 6 },
  },
});

const renderMenu = (
  view: DefaultView,
  {
    seed = seedFor(),
    answered = false,
  }: { seed?: ChromeSeed; answered?: boolean } = {}
) => {
  history.replaceState(null, '', '?view=tab');
  return renderWithProviders(<MenuContainer />, {
    seed,
    seedStore: (store) => {
      store.dispatch(setDefaultView(view));
      if (answered) store.dispatch(markClosesThisTabCardAnswered());
    },
  });
};

const back = () => screen.getByRole('button', { name: 'Back to your tab' });
const compact = () =>
  screen.getAllByRole('button', { name: 'Open compact view' })[0];
const card = () => screen.getByRole('dialog');
const cardButton = (name: string) =>
  within(card()).getByRole('button', { name });
const answered = (store: {
  getState(): { settingsDataState: { isClosesThisTabCardAnswered: boolean } };
}) => store.getState().settingsDataState.isClosesThisTabCardAnswered;
// A press that sends nothing has nothing to wait for; give a wrong send time to land.
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

afterEach(() => {
  history.replaceState(null, '', '?');
  vi.restoreAllMocks();
});

describe('Back to your tab, from an unpinned full view (KAN-578)', () => {
  const pressBack = async () => {
    const rendered = await renderMenu('full');
    await waitFor(() => expect(back()).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(back());
    await screen.findByRole('dialog');
    return rendered;
  };

  test('the first press shows the card and sends nothing; Go back is focused', async () => {
    const { chrome } = await pressBack();

    expect(card()).toHaveTextContent(BACK_TEXT);
    expect(cardButton('Go back')).toHaveFocus();
    expect(cardButton('Pin and go back')).toBeInTheDocument();
    await settle();
    expect(chrome.sentMessages).toEqual([]);
  });

  test('Go back sends one message, closes the card and is remembered', async () => {
    const { chrome, store } = await pressBack();

    fireEvent.click(cardButton('Go back'));

    await waitFor(() =>
      expect(chrome.sentMessages).toEqual([
        { type: RETURN_FROM_FULL_VIEW_MESSAGE },
      ])
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(answered(store)).toBe(true);
  });

  test('after Go back, the next press goes back at once', async () => {
    const { chrome } = await pressBack();
    fireEvent.click(cardButton('Go back'));
    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));

    fireEvent.click(back());

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('Pin and go back pins this tab before it asks to go back', async () => {
    const { chrome, store } = await pressBack();
    const pinnedWhenSent: boolean[] = [];
    const send = globalThis.chrome.runtime.sendMessage;
    vi.spyOn(globalThis.chrome.runtime, 'sendMessage').mockImplementation(
      async (...args: Parameters<typeof send>) => {
        const self = await globalThis.chrome.tabs.get(7);
        pinnedWhenSent.push(self.pinned);
        return send(...args);
      }
    );

    fireEvent.click(cardButton('Pin and go back'));

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(pinnedWhenSent).toEqual([true]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(answered(store)).toBe(true);
  });

  test('a pin that fails sends nothing, keeps the card and is not remembered', async () => {
    const { chrome, store } = await pressBack();
    vi.spyOn(globalThis.chrome.tabs, 'update').mockRejectedValue(
      new Error('Tabs cannot be edited right now')
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    fireEvent.click(cardButton('Pin and go back'));

    await waitFor(() => expect(warn).toHaveBeenCalled());
    await settle();
    expect(chrome.sentMessages).toEqual([]);
    expect(card()).toBeInTheDocument();
    expect(answered(store)).toBe(false);
  });

  test('✕ cancels: nothing sent, not remembered, focus back on Back', async () => {
    const { chrome, store } = await pressBack();

    fireEvent.click(cardButton('Close'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(back()).toHaveFocus();
    await settle();
    expect(chrome.sentMessages).toEqual([]);
    expect(answered(store)).toBe(false);
  });

  test('Esc cancels and is consumed, so Chrome does not act on it', async () => {
    const { chrome, store } = await pressBack();

    const esc = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(esc);

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(esc.defaultPrevented).toBe(true);
    expect(back()).toHaveFocus();
    await settle();
    expect(chrome.sentMessages).toEqual([]);
    expect(answered(store)).toBe(false);
  });

  test('a press outside cancels', async () => {
    const { chrome, store } = await pressBack();

    fireEvent.pointerDown(document.body);

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await settle();
    expect(chrome.sentMessages).toEqual([]);
    expect(answered(store)).toBe(false);
  });

  test('a cancelled card comes back on the next press', async () => {
    await pressBack();
    fireEvent.click(cardButton('Close'));

    fireEvent.click(back());

    expect(await screen.findByRole('dialog')).toHaveTextContent(BACK_TEXT);
  });

  test('answered on this device: no card, the press goes back at once', async () => {
    const { chrome } = await renderMenu('full', { answered: true });
    await waitFor(() => expect(back()).not.toHaveAttribute('aria-disabled'));

    fireEvent.click(back());

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Back to your tab, when the press closes nothing or only closes (KAN-578)', () => {
  test('a pinned full view: no card, the press goes back at once', async () => {
    const { chrome } = await renderMenu('full', { seed: seedFor(true) });
    await waitFor(() => expect(back()).not.toHaveAttribute('aria-disabled'));

    fireEvent.click(back());

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // KAN-580. Nothing recorded: a pinned full view goes to its neighbour, so Pin still has somewhere to go.
  test('nothing recorded to switch to: the card still offers Pin and go back', async () => {
    await renderMenu('full', {
      seed: { ...seedFor(), sessionArea: {} },
    });
    await waitFor(() => expect(back()).not.toHaveAttribute('aria-disabled'));

    fireEvent.click(back());

    await screen.findByRole('dialog');
    expect(cardButton('Go back')).toBeInTheDocument();
    expect(cardButton('Pin and go back')).toBeInTheDocument();
  });
});

describe('Open compact view (KAN-578)', () => {
  test('beside other tabs: the card, then its Open compact view sends one message', async () => {
    const { chrome, store } = await renderMenu('compact');

    fireEvent.click(compact());
    await screen.findByRole('dialog');
    expect(card()).toHaveTextContent(COMPACT_TEXT);
    expect(cardButton('Pin and open')).toBeInTheDocument();
    expect(cardButton('Open compact view')).toHaveFocus();
    await settle();
    expect(chrome.sentMessages).toEqual([]);

    fireEvent.click(cardButton('Open compact view'));

    await waitFor(() =>
      expect(chrome.sentMessages).toEqual([{ type: OPEN_IN_POPUP_MESSAGE }])
    );
    expect(answered(store)).toBe(true);
  });

  test('the only tab Chrome has: no card, the popup opens over it', async () => {
    const { chrome } = await renderMenu('compact', {
      seed: {
        action: {},
        currentTabId: 7,
        windows: [{ id: 1, tabs: [fullViewTab()] }],
      },
    });

    fireEvent.click(compact());

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('pinned: no card', async () => {
    const { chrome } = await renderMenu('compact', { seed: seedFor(true) });

    fireEvent.click(compact());

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // Fail toward the warning: a press that might close the tab asks.
  test('this tab cannot be read: the card shows', async () => {
    await renderMenu('compact');
    vi.spyOn(globalThis.chrome.tabs, 'getCurrent').mockRejectedValue(
      new Error('gone')
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    fireEvent.click(compact());

    expect(await screen.findByRole('dialog')).toHaveTextContent(COMPACT_TEXT);
  });

  test('after its Open compact view, the next press opens at once', async () => {
    const { chrome } = await renderMenu('compact');
    fireEvent.click(compact());
    await screen.findByRole('dialog');
    fireEvent.click(cardButton('Open compact view'));
    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));

    fireEvent.click(compact());

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe("Open now's Back to your tab chip (KAN-578)", () => {
  test('the first press shows the card; Go back sends one message', async () => {
    history.replaceState(null, '', '?view=tab');
    const { chrome } = await renderWithProviders(
      <OpenNowPane
        windows={[]}
        actions={[]}
        headingId="open-now-heading"
        searchText=""
        onSearchTextChange={() => undefined}
        searchInputRef={createRef<HTMLInputElement>()}
      />,
      { seed: seedFor() }
    );
    await waitFor(() => expect(back()).not.toHaveAttribute('aria-disabled'));

    fireEvent.click(back());
    expect(await screen.findByRole('dialog')).toHaveTextContent(BACK_TEXT);
    await settle();
    expect(chrome.sentMessages).toEqual([]);

    fireEvent.click(cardButton('Go back'));

    await waitFor(() =>
      expect(chrome.sentMessages).toEqual([
        { type: RETURN_FROM_FULL_VIEW_MESSAGE },
      ])
    );
  });
});
