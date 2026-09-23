import { afterEach, describe, expect, test } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-208 / KAN-300. Exporting what is open right now, without saving it
// first.
//
// The page captures the open windows for itself -- chrome.windows.getAll works
// from an extension page -- and holds the capture in React state. It is never
// dispatched: replaceState writes localStorage, so a dispatched capture would
// become an unsaved session in the list, which is the clutter this export
// exists to avoid. Nothing in the data state changes, so there is no undo
// entry and nothing for the sync middleware to push.
//
// The page is one of the open tabs, and is left out along with every OTHER
// Tab Keeper page open anywhere in the capture (KAN-300, isTabKeeperPage in
// capture.ts) -- by address, not by which tab id happens to be "the page".

const OWN_URL = 'chrome-extension://faketestid/export.html?source=open-windows';
const A = 'https://kagi.com/';
const B = 'https://example.com/';

// Two windows; the page's own tab sits in the first, beside a real one.
const twoWindows = {
  windows: [
    {
      id: 1,
      tabs: [
        { id: 10, url: OWN_URL, title: 'Tab Keeper' },
        { id: 11, url: A, title: 'Kagi Search' },
      ] as chrome.tabs.Tab[],
    },
    {
      id: 2,
      tabs: [{ id: 12, url: B, title: 'Example' }] as chrome.tabs.Tab[],
    },
  ],
  currentTabId: 10,
};

const LIVE = { kind: 'open-windows' } as const;

const frame = (): HTMLIFrameElement => {
  const found = document.querySelector('iframe');
  if (!found) throw new Error('the page renders no preview frame');
  return found as HTMLIFrameElement;
};

const renderLive = (seed = twoWindows) =>
  renderWithProviders(<ExportPage source={LIVE} />, { seed });

afterEach(() => {
  localStorage.clear();
});

describe('exporting the open windows (KAN-208)', () => {
  test('previews every open tab except the page itself', async () => {
    await renderLive();

    await waitFor(() => expect(frame().srcdoc).toContain('Kagi Search'));
    expect(frame().srcdoc).toContain('Example');
    expect(frame().srcdoc).not.toContain('export.html');
    expect(screen.getByText('2 Windows · 2 Tabs')).toBeTruthy();
  });

  // CHANGED for KAN-300 (was "CONTROL: naming another tab as the page keeps
  // the export.html tab", proving KAN-208's BY-ID exclusion -- naming a
  // different tab as "the page" used to keep the export.html tab in the
  // capture, since a match-by-id rule has no opinion about a tab it was never
  // told is "the page"). KAN-300 excludes by ADDRESS instead, so naming
  // another tab as "the page" no longer matters: export.html is still
  // excluded, on its own address, regardless of what chrome.tabs.getCurrent()
  // answers.
  test('naming another tab as the page still excludes export.html, by its own address', async () => {
    await renderLive({ ...twoWindows, currentTabId: 11 });

    await waitFor(() => expect(frame().srcdoc).toContain('Kagi Search'));
    expect(frame().srcdoc).not.toContain('export.html');
  });

  // KAN-300. A second, genuinely different Tab Keeper page (the tab view,
  // say, open beside this export tab) used to survive KAN-208's by-id
  // exclusion -- a DIFFERENT address, so a match-by-id rule let it through.
  // The address-based rule catches it too.
  test('a second, genuinely different Tab Keeper page is excluded too', async () => {
    const TAB_VIEW = 'chrome-extension://faketestid/index.html?view=tab';
    await renderLive({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, url: OWN_URL, title: 'Tab Keeper' },
            { id: 13, url: TAB_VIEW, title: 'Tab Keeper' },
            { id: 11, url: A, title: 'Kagi Search' },
          ] as chrome.tabs.Tab[],
        },
        {
          id: 2,
          tabs: [{ id: 12, url: B, title: 'Example' }] as chrome.tabs.Tab[],
        },
      ],
      currentTabId: 10,
    });

    await waitFor(() => expect(frame().srcdoc).toContain('Kagi Search'));
    expect(frame().srcdoc).toContain('Example');
    expect(frame().srcdoc).not.toContain('export.html');
    expect(frame().srcdoc).not.toContain('view=tab');
    expect(screen.getByText('2 Windows · 2 Tabs')).toBeTruthy();
  });

  test('is named "Open windows", in the header and the tab', async () => {
    await renderLive();

    expect(await screen.findByText('Open windows')).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Open windows'));
  });

  test('the file carries no date line, only the counts', async () => {
    await renderLive();

    await waitFor(() => expect(frame().srcdoc).toContain('Kagi Search'));
    expect(frame().srcdoc).toContain('<p class="meta">2 Windows · 2 Tabs</p>');
    expect(frame().srcdoc).not.toContain('Created');
  });

  // CONTROL for the test above: the saved path still writes the date.
  test('CONTROL: a saved session still carries its date line', async () => {
    await renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 's' }} />,
      {
        seedStore: (store) => {
          store.dispatch(
            replaceState(buildContainer([buildSession({ tabGroupId: 's' })]))
          );
        },
      }
    );

    await waitFor(() => expect(frame().srcdoc).toContain('Created'));
  });

  test('offers edit mode', async () => {
    await renderLive();

    await waitFor(() => expect(frame().srcdoc).toContain('Kagi Search'));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  // The point of the ticket. Three things that a dispatched capture would
  // change, asserted separately so the failure names which one moved.
  test('saves nothing: storage untouched, no data action, no undo entry', async () => {
    const { store, seen } = await renderLive();
    await waitFor(() => expect(frame().srcdoc).toContain('Kagi Search'));

    expect(localStorage.getItem('tabContainerData')).toBeNull();
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
    expect(
      seen.filter((type) => type.startsWith('tabContainerDataState/'))
    ).toEqual([]);
    expect(store.getState().undoRedo.past).toEqual([]);
  });

  // CONTROL: the recorder can see a data-state dispatch. The saved path loads
  // storage through replaceState -- the very action a dispatched capture would
  // take -- so a recorder that saw nothing above proves something.
  test('CONTROL: the saved path does dispatch into the data state', async () => {
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(
        buildContainer([buildSession({ tabGroupId: 's', title: 'Saved one' })])
      )
    );

    const { seen } = await renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 's' }} />
    );

    expect(await screen.findByText('Saved one')).toBeTruthy();
    expect(seen).toContain('tabContainerDataState/replaceState');
  });

  // The edge: the page is the only tab open. "Session not found" is the page's
  // existing empty state -- but it must appear AFTER the capture, not while it
  // is still running, or every load flashes it.
  //
  // The first two assertions run before the capture has settled: the effect
  // starts inside render()'s act, awaits tabs.getCurrent, and this test's own
  // continuation is queued behind that first hop but ahead of the capture's
  // remaining ones. If that ordering ever changes this fails LOUDLY on the
  // `data-capturing` line, not silently.
  test('with nothing open but itself, says not found -- after capturing', async () => {
    await renderLive({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, url: OWN_URL, title: 'Tab Keeper' },
          ] as chrome.tabs.Tab[],
        },
      ],
      currentTabId: 10,
    });

    expect(document.querySelector('[data-capturing]')).toBeTruthy();
    expect(screen.queryByText('Session not found')).toBeNull();

    expect(await screen.findByText('Session not found')).toBeTruthy();
    expect(document.querySelector('[data-capturing]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save as HTML' })).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });
});
