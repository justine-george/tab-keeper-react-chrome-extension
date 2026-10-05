import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import FirstRun from '../../components/tour/FirstRun';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { startRun } from '../../redux/firstRun';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { newRun, type FirstRun as Run } from '../../utils/functions/firstRun';

// The controller: Hello at full-view step 0, then the card each step names, with its buttons.

const RECT: DOMRect = {
  x: 40,
  y: 100,
  left: 40,
  top: 100,
  right: 340,
  bottom: 140,
  width: 300,
  height: 40,
  toJSON: () => ({}),
};

// The anchors the tested steps name, drawn with a box, as the panes draw them.
let anchors: HTMLElement;
let locks: FakeLocks;
beforeEach(() => {
  locks = installFakeLocks();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  anchors = document.createElement('div');
  anchors.innerHTML =
    '<div data-pane="sessions"><div data-tour-anchor="save"></div>' +
    '<div data-tour-anchor="sessions"></div></div>' +
    '<span data-tour-anchor="expand"></span>';
  for (const element of anchors.querySelectorAll('*')) {
    element.getBoundingClientRect = () => RECT;
  }
  document.body.append(anchors);
});
afterEach(() => {
  anchors.remove();
  locks.uninstall();
  localStorage.clear();
  history.replaceState(null, '', '?');
  vi.restoreAllMocks();
});

const SEED = {
  windows: [
    {
      id: 1,
      type: 'normal' as const,
      tabs: [{ id: 11, url: 'https://example.com/', title: 'Example' }],
    },
  ],
};
const OWN = () =>
  buildSession({ tabGroupId: 'own', title: 'Own', isSelected: true });

async function renderAt(run: Run, sessions = [OWN()]) {
  const r = await renderWithProviders(<FirstRun />, {
    seed: SEED,
    seedStore: (store) =>
      store.dispatch(replaceState(buildContainer(sessions))),
  });
  await act(async () => {
    await r.store.dispatch(startRun(run));
  });
  return r;
}
const runOf = (r: RenderWithProvidersResult) =>
  r.store.getState().settingsDataState.firstRun;
const mark = () => document.querySelector('[data-coach-mark]');
const escape = () =>
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
  });

describe('the controller', () => {
  test('full view step 0: Hello (welcome); Start moves to step 1', async () => {
    history.replaceState(null, '', '?view=tab');
    const r = await renderAt(newRun('full', 0, 'welcome'));
    expect(
      screen.getByRole('dialog', { name: 'Welcome to Tab Keeper' })
    ).toHaveAttribute('data-run-hello');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(runOf(r)?.step).toBe(1);
  });

  test('the What’s new Hello marks itself seen', async () => {
    history.replaceState(null, '', '?view=tab');
    const r = await renderAt(newRun('full', 0, 'whatsNew'));
    expect(
      screen.getByRole('dialog', { name: "What's new in Tab Keeper 2.0" })
    ).toBeVisible();
    expect(r.store.getState().settingsDataState.isWhatsNew2Seen).toBe(true);
  });

  test('the welcome Hello leaves What’s new unseen', async () => {
    history.replaceState(null, '', '?view=tab');
    const r = await renderAt(newRun('full', 0, 'welcome'));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(r.store.getState().settingsDataState.isWhatsNew2Seen).toBe(false);
  });

  test('Hello’s cancel is Skip tutorial', async () => {
    history.replaceState(null, '', '?view=tab');
    const r = await renderAt(newRun('full', 0, 'welcome'));
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true })
    );
    expect(runOf(r)?.ended).toBe('skipped');
  });

  test('popup step 1: the save card, its glyph named, and Use an example', async () => {
    const r = await renderAt(newRun('popup', 1));
    await waitFor(() =>
      expect(r.store.getState().globalState.runSaveCard).toBe('save')
    );
    expect(
      await screen.findByRole('img', {
        name: 'Save all open windows as a session',
      })
    ).toBeInTheDocument();
    expect(mark()).toHaveAttribute('data-coach-step', '1');
    expect(mark()).toHaveTextContent(
      'Saving keeps them safe even after you close them.'
    );
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Skip tutorial' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use an example' }));
    expect(runOf(r)).toMatchObject({ step: 2 });
  });

  test('sessions on disk still loading: no card is drawn; after the load it is (Review Focus 2)', async () => {
    history.replaceState(null, '', '?view=tab');
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([OWN()]))
    );
    const r = await renderWithProviders(<FirstRun />, { seed: SEED });
    await act(async () => {
      await r.store.dispatch(startRun(newRun('full', 3)));
    });
    expect(mark()).toBeNull();
    expect(r.store.getState().globalState.runSaveCard).toBeNull();
    act(() => {
      r.store.dispatch(replaceState(buildContainer([OWN()])));
    });
    await waitFor(() =>
      expect(r.store.getState().globalState.runSaveCard).toBe('sessions')
    );
    expect(mark()).not.toBeNull();
  });

  test('sessions written to disk after this page opened: the save card waits for the load, then is decided', async () => {
    history.replaceState(null, '', '?view=tab');
    const r = await renderWithProviders(<FirstRun />, { seed: SEED });
    // Another page saved after this one mounted, so this page now has sessions to load.
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([OWN()]))
    );
    await act(async () => {
      await r.store.dispatch(startRun(newRun('full', 3)));
    });
    expect(r.store.getState().globalState.runSaveCard).toBeNull();
    act(() => {
      r.store.dispatch(replaceState(buildContainer([OWN()])));
    });
    await waitFor(() =>
      expect(r.store.getState().globalState.runSaveCard).toBe('sessions')
    );
  });

  test('the last popup step: Back and Done, no Skip; Done finishes', async () => {
    const r = await renderAt({ ...newRun('popup', 7), sessionId: 'own' });
    const done = await screen.findByRole('button', { name: 'Done' });
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip tutorial' })).toBeNull();
    fireEvent.click(done);
    expect(runOf(r)?.ended).toBe('finished');
  });

  test('Esc on a middle card is Skip tutorial (§6)', async () => {
    const r = await renderAt(newRun('popup', 1));
    await screen.findByRole('button', { name: 'Use an example' });
    escape();
    expect(runOf(r)?.ended).toBe('skipped');
  });

  test('Esc on the last card is its non-pin button (R5)', async () => {
    const r = await renderAt({ ...newRun('popup', 7), sessionId: 'own' });
    await screen.findByRole('button', { name: 'Done' });
    escape();
    expect(runOf(r)?.ended).toBe('finished');
  });

  test('Pin this tab on a tab already pinned pins nothing more, and the run ends', async () => {
    history.replaceState(null, '', '?view=tab');
    const r = await renderWithProviders(<FirstRun />, {
      seed: {
        ...SEED,
        tabs: [
          {
            id: 7,
            windowId: 1,
            pinned: true,
            url: 'chrome-extension://faketestid/index.html?view=tab',
          },
        ],
        currentTabId: 7,
      },
      seedStore: (store) =>
        store.dispatch(replaceState(buildContainer([OWN()]))),
    });
    const update = vi.spyOn(chrome.tabs, 'update');
    await act(async () => {
      await r.store.dispatch(
        startRun({ ...newRun('full', 8), sessionId: 'own' })
      );
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pin this tab' })
    );
    await waitFor(() => expect(runOf(r)?.ended).toBe('finished'));
    expect(update).not.toHaveBeenCalled();
  });

  test('a refused pin is logged, and the run ends as for Not now', async () => {
    history.replaceState(null, '', '?view=tab');
    const r = await renderWithProviders(<FirstRun />, {
      seed: {
        ...SEED,
        tabs: [
          {
            id: 7,
            windowId: 1,
            url: 'chrome-extension://faketestid/index.html?view=tab',
          },
        ],
        currentTabId: 7,
      },
      seedStore: (store) =>
        store.dispatch(replaceState(buildContainer([OWN()]))),
    });
    vi.spyOn(chrome.tabs, 'update').mockRejectedValue(new Error('refused'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await act(async () => {
      await r.store.dispatch(
        startRun({ ...newRun('full', 8), sessionId: 'own' })
      );
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pin this tab' })
    );
    await waitFor(() => expect(runOf(r)?.ended).toBe('finished'));
    expect(warn).toHaveBeenCalled();
  });

  test('the last full-view step: Back, Not now, Pin this tab', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderAt({ ...newRun('full', 8), sessionId: 'own' });
    await screen.findByRole('button', { name: 'Pin this tab' });
    expect(
      [...document.querySelectorAll('[data-coach-mark] button')].map(
        (b) => b.textContent
      )
    ).toEqual(['Back', 'Not now', 'Pin this tab']);
  });
});
