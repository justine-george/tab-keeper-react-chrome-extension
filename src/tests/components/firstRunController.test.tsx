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
import {
  peekSavedSession,
  setRunSaveEcho,
} from '../../redux/slices/globalStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { firstOpenDialogs } from '../../redux/firstOpenDialogs';
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
    '<span data-tour-anchor="expand"></span>' +
    '<div data-pane="open-now"><div data-open-now-search></div></div>';
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

describe('the controller', () => {
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
});

describe('step 2 names the fold button the view shows', () => {
  // KAN-500. The grip needs a window above 1316px; jsdom's own is 1024px.
  const ORIGINAL_INNER_WIDTH = window.innerWidth;
  const widthOf = (px: number) => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: px,
    });
    window.dispatchEvent(new Event('resize'));
  };
  afterEach(() => widthOf(ORIGINAL_INNER_WIDTH));

  test('folded but peeked: the saved session is beside Open now, so the card names «', async () => {
    widthOf(1400);
    history.replaceState(null, '', '?view=tab');
    const r = await renderAt(newRun('full', 2));
    act(() => {
      r.store.dispatch(peekSavedSession());
    });
    expect(
      await screen.findByRole('img', { name: 'Fold the saved session away' })
    ).toBeInTheDocument();
    expect(mark()).toHaveTextContent('Drag the edge');
  });
});

// §13: the open's own resume, from the queue's entry, while the saved list is still to load.
describe('a resume while sessions on disk are still loading', () => {
  test.each([
    ['a session step', { ...newRun('popup', 2), sessionId: 'own' }],
    ['the save step', newRun('full', 3)],
    // No session in these steps' plans: only the settled gate holds them.
    ['full step 1, Open now', { ...newRun('full', 1), sessionId: 'own' }],
    ['full step 2, find and fit', { ...newRun('full', 2), sessionId: 'own' }],
    ['full step 8, two views', { ...newRun('full', 8), sessionId: 'own' }],
    ['popup step 7, ⤢', { ...newRun('popup', 7), sessionId: 'own' }],
  ])('%s: no card until the load; then the card', async (_, run) => {
    if (run.view === 'full') history.replaceState(null, '', '?view=tab');
    const row = document.createElement('div');
    row.dataset.dragRowId = 'own';
    row.getBoundingClientRect = () => RECT;
    anchors.querySelector('[data-pane="sessions"]')?.append(row);
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([OWN()]))
    );
    const r = await renderWithProviders(<FirstRun />, { seed: SEED });
    r.store.dispatch(recordFirstRun(run));
    const entry = firstOpenDialogs(run.view, {
      dispatch: r.store.dispatch,
      storedAtOpen: { firstRun: run },
      storedSessions: 1,
      getState: r.store.getState,
    }).find((e) => e.id === 'firstRun');
    const open = await entry?.decide();
    await act(async () => {
      if (typeof open === 'function') open();
      await Promise.resolve();
    });
    expect(r.store.getState().globalState.isRunHere).toBe(true);
    expect(mark()).toBeNull();
    expect(r.store.getState().globalState.runSaveCard).toBeNull();
    act(() => {
      r.store.dispatch(replaceState(buildContainer([OWN()])));
    });
    await waitFor(() => expect(mark()).not.toBeNull());
    expect(runOf(r)).toMatchObject({ step: run.step, sessionId: 'own' });
  });
});

describe('Back to the save step after the run’s save (R6, A5, M4)', () => {
  const TEXT = 'Saved. Press';

  test('a popup run resumed with its session already set shows the same card (A5)', async () => {
    await renderAt({ ...newRun('popup', 1), sessionId: 'own' });
    expect(await screen.findByRole('button', { name: 'Next' })).toBeVisible();
    expect(mark()).toHaveTextContent(TEXT);
    expect(screen.queryByRole('button', { name: 'Use an example' })).toBeNull();
  });
});

describe('the first save’s echo (§10)', () => {
  test('the new session’s tab dots settle by 3px, 40ms apart; then the flag clears', async () => {
    const played: { keyframes: Keyframe[]; delay: number }[] = [];
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value(
        this: Element,
        keyframes: Keyframe[],
        options: KeyframeAnimationOptions
      ) {
        if (this.matches('[data-tour-anchor="tab-dot"]')) {
          played.push({ keyframes, delay: Number(options.delay ?? 0) });
        }
        return { cancel: () => undefined, finished: Promise.resolve() };
      },
    });
    const dots = [0, 1, 2].map(() => {
      const dot = document.createElement('span');
      dot.setAttribute('data-tour-anchor', 'tab-dot');
      return dot;
    });
    const detail = document.createElement('div');
    detail.setAttribute('data-pane', 'detail');
    detail.append(...dots);
    document.body.append(detail);
    try {
      const r = await renderAt(newRun('popup', 1));
      act(() => {
        r.store.dispatch(setRunSaveEcho('own'));
      });
      await waitFor(() => expect(played).toHaveLength(3));
      expect(played.map((p) => p.delay)).toEqual([0, 40, 80]);
      expect(played[0].keyframes[0]).toEqual({ transform: 'translateY(-3px)' });
      await waitFor(() =>
        expect(r.store.getState().globalState.runSaveEcho).toBeNull()
      );
    } finally {
      detail.remove();
      Reflect.deleteProperty(Element.prototype, 'animate');
    }
  });
});
