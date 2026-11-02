import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import RightPane from '../../components/home/rightpane/RightPane';
import { OpenCopiesProvider } from '../../components/home/rightpane/OpenCopiesProvider';
import { useOpenCopyAddresses } from '../../components/home/rightpane/openCopies';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../setup/chrome.fake';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-890. A saved tab row's name says what a plain click does (KAN-884):
// Switch to tab while a copy is open, Open in new tab otherwise.

let fake: ChromeFakeHandle | undefined;

afterEach(() => {
  fake?.restore();
  fake = undefined;
  localStorage.clear();
  vi.restoreAllMocks();
});

// Lets pending chrome answers land; never a wait for a re-read (those are polled).
const settle = () =>
  act(() => new Promise<void>((done) => setTimeout(done, 0)));

// Window 1 is Tab Keeper's, in front; window 2 holds a copy of a.test.
const SEED: ChromeSeed = {
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
};

async function renderSaved() {
  const session = buildSession({
    isSelected: true,
    windows: [
      {
        windowId: 'win-1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 2,
        title: 'Reading',
        tabs: [
          {
            tabId: 't1',
            favicon: '',
            title: 'Open one',
            url: 'https://a.test/',
          },
          {
            tabId: 't2',
            favicon: '',
            title: 'Closed one',
            url: 'https://b.test/',
          },
        ],
        chromeTabGroups: [],
      },
    ],
  });
  const r = await renderWithProviders(<RightPane />, {
    seed: SEED,
    seedStore: (store) => {
      store.dispatch(saveToTabContainerInternal(session));
      store.dispatch(selectTabContainer(session.tabGroupId));
    },
  });
  await settle();
  return r;
}

const named = (name: string) => screen.queryByRole('button', { name });

// Polled: a re-read lands after the 50ms coalesce, later on a slow machine.
const expectShown = (name: string) =>
  waitFor(() => expect(named(name)).not.toBeNull());

describe('a saved tab row’s name', () => {
  test('says Switch to tab while a copy is open, Open in new tab otherwise', async () => {
    await renderSaved();

    await expectShown('Switch to tab: Open one');
    expect(named('Open in new tab: Closed one')).not.toBeNull();
    expect(named('Open in new tab: Open one')).toBeNull();
  });

  test('follows the browser: a copy opening or closing changes it', async () => {
    const r = await renderSaved();
    await expectShown('Switch to tab: Open one');

    act(() => {
      r.chrome.browser.openTab(1, { url: 'https://b.test/' });
      r.chrome.browser.closeTab(21);
    });

    await expectShown('Open in new tab: Open one');
    await expectShown('Switch to tab: Closed one');
  });

  test('a copy navigating away changes it back', async () => {
    const r = await renderSaved();
    await expectShown('Switch to tab: Open one');

    act(() => r.chrome.browser.updateTab(21, { url: 'https://c.test/' }));

    await expectShown('Open in new tab: Open one');
  });

  test('the row named Switch to tab switches, and opens nothing', async () => {
    const r = await renderSaved();
    await expectShown('Switch to tab: Open one');

    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to tab: Open one' })
    );

    await vi.waitFor(async () =>
      expect((await chrome.windows.getLastFocused()).id).toBe(2)
    );
    expect(r.chrome.createdTabs).toEqual([]);
  });

  test('the live read stops when the saved session goes', async () => {
    const r = await renderSaved();
    expect(r.chrome.liveEventListenerCount()).toBeGreaterThan(0);

    r.unmount();

    expect(r.chrome.liveEventListenerCount()).toBe(0);
  });
});

describe('OpenCopiesProvider', () => {
  test('a page load or a tab switch keeps the same value, so no row re-renders', async () => {
    fake = setupChromeFake(SEED);
    const seen: ReadonlySet<string>[] = [];
    function Probe() {
      seen.push(useOpenCopyAddresses());
      return null;
    }
    render(
      <OpenCopiesProvider>
        <Probe />
      </OpenCopiesProvider>
    );
    await waitFor(() =>
      expect(seen[seen.length - 1]?.has('https://a.test/')).toBe(true)
    );
    const first = seen[seen.length - 1];
    const renders = seen.length;
    const reads = fake.windowsGetAllCalls;

    act(() => {
      fake?.browser.updateTab(21, { status: 'loading', title: 'Loading' });
      fake?.browser.activateTab(21);
    });
    // PREMISE: the events were read again, and that read has landed.
    await waitFor(() =>
      expect(fake?.windowsGetAllCalls).toBeGreaterThan(reads)
    );
    await settle();

    expect(seen.length).toBe(renders);
    expect(seen[seen.length - 1]).toBe(first);
  });
});
