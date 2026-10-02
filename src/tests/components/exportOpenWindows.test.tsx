import { afterEach, describe, expect, test } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { buildChromeTab } from '../fixtures/chromeTab';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';

// The capture stays in React state, never dispatched: replaceState writes
// localStorage, so it would become an unsaved session, an undo entry and a sync
// push.
// Tab Keeper pages are left out by address, not by tab id (KAN-300).

const OWN_URL = 'chrome-extension://faketestid/export.html?source=open-windows';
const A = 'https://kagi.com/';
const B = 'https://example.com/';

// Two windows; the page's own tab sits in the first, beside a real one.
const twoWindows = {
  windows: [
    {
      id: 1,
      tabs: [
        buildChromeTab({ id: 10, url: OWN_URL, title: 'Tab Keeper' }),
        buildChromeTab({ id: 11, url: A, title: 'Kagi Search' }),
      ],
    },
    {
      id: 2,
      tabs: [buildChromeTab({ id: 12, url: B, title: 'Example', windowId: 2 })],
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

  // KAN-300: a by-id rule would let this through.
  test('a second, genuinely different Tab Keeper page is excluded too', async () => {
    const TAB_VIEW = 'chrome-extension://faketestid/index.html?view=tab';
    await renderLive({
      windows: [
        {
          id: 1,
          tabs: [
            buildChromeTab({ id: 10, url: OWN_URL, title: 'Tab Keeper' }),
            buildChromeTab({ id: 13, url: TAB_VIEW, title: 'Tab Keeper' }),
            buildChromeTab({ id: 11, url: A, title: 'Kagi Search' }),
          ],
        },
        {
          id: 2,
          tabs: [
            buildChromeTab({ id: 12, url: B, title: 'Example', windowId: 2 }),
          ],
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

  // Asserted separately so a failure names which one moved.
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

  // CONTROL: the recorder sees replaceState, the action a dispatched capture
  // would take.
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

  // "Session not found" must wait for the capture, or every load flashes it.
  // The first two assertions run mid-capture: this continuation is queued after
  // the capture's first hop (windows.getCurrent) and before the rest. If that
  // ordering changes, this fails loudly on the `data-capturing` line.
  test('with nothing open but itself, says not found -- after capturing', async () => {
    await renderLive({
      windows: [
        {
          id: 1,
          tabs: [buildChromeTab({ id: 10, url: OWN_URL, title: 'Tab Keeper' })],
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
