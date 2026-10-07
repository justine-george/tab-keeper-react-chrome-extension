import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import FirstRun from '../../components/tour/FirstRun';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { startRun, takeRunSave } from '../../redux/firstRun';
import {
  peekSavedSession,
  setRunSaveEcho,
} from '../../redux/slices/globalStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import {
  recordFirstRun,
  setFoldSavedSessionInTabView,
} from '../../redux/slices/settingsDataStateSlice';
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

  test('the last full-view step: Not now, Back, Pin this tab, on a 25rem card (400px at a 16px root)', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderAt({ ...newRun('full', 8), sessionId: 'own' });
    await screen.findByRole('button', { name: 'Pin this tab' });
    expect(
      [...document.querySelectorAll('[data-coach-mark] button')].map(
        (b) => b.textContent
      )
    ).toEqual(['Not now', 'Back', 'Pin this tab']);
    const mark = document.querySelector('[data-coach-mark]');
    expect(mark && getComputedStyle(mark).width).toBe('400px');
  });

  test('Next onto the save step keeps the card mounted: it moves, it is not drawn anew (KAN-436)', async () => {
    history.replaceState(null, '', '?view=tab');
    const r = await renderAt(newRun('full', 2), []);
    await screen.findByRole('button', { name: 'Next' });
    const before = mark();
    let removed = false;
    const observer = new MutationObserver(() => {
      if (before !== null && !before.isConnected) removed = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: 'Use an example' });
    observer.disconnect();
    expect(runOf(r)?.step).toBe(3);
    expect(mark()).toBe(before);
    expect(removed).toBe(false);
  });

  test('only Tab Keeper open: the Q3 card, its glyph, no fine line, and Use an example as the only way on', async () => {
    const r = await renderWithProviders(<FirstRun />, {
      seed: {
        windows: [
          {
            id: 1,
            type: 'normal' as const,
            tabs: [
              {
                id: 12,
                url: 'chrome-extension://faketestid/index.html?view=tab',
                title: 'Tab Keeper',
              },
            ],
          },
        ],
      },
      seedStore: (store) => store.dispatch(replaceState(buildContainer([]))),
    });
    await act(async () => {
      await r.store.dispatch(startRun(newRun('popup', 1)));
    });
    await waitFor(() =>
      expect(r.store.getState().globalState.runSaveCard).toBe('nothingToSave')
    );
    expect(
      await screen.findByRole('img', {
        name: 'Save all open windows as a session',
      })
    ).toBeInTheDocument();
    const [text, ...others] = mark()?.querySelectorAll('p') ?? [];
    expect(others).toHaveLength(0);
    expect(text).toHaveTextContent(
      'This is where you save your open windows as a session: press'
    );
    expect(text).toHaveTextContent(
      ". Only Tab Keeper is open right now, so let's try it with an example."
    );
    expect(
      [...document.querySelectorAll('[data-coach-mark] button')].map(
        (b) => b.textContent
      )
    ).toEqual(['Skip tutorial', 'Use an example']);
  });
});

describe('step 2 names the fold button the view shows', () => {
  test('folded: press » to show the saved session, no edge; unfolding switches the card to the edge and «, still at step 2', async () => {
    history.replaceState(null, '', '?view=tab');
    const r = await renderAt(newRun('full', 2));
    expect(r.store.getState().settingsDataState.foldSavedSessionInTabView).toBe(
      true
    );
    expect(
      await screen.findByRole('img', { name: 'Show the saved session' })
    ).toHaveTextContent('keyboard_double_arrow_right');
    expect(mark()).toHaveTextContent(
      'Search here to find an open tab fast. Press'
    );
    expect(mark()).toHaveTextContent('to show the saved session beside it.');
    expect(mark()).not.toHaveTextContent('Drag the edge');
    act(() => {
      r.store.dispatch(setFoldSavedSessionInTabView(false));
    });
    expect(
      await screen.findByRole('img', { name: 'Fold the saved session away' })
    ).toHaveTextContent('keyboard_double_arrow_left');
    expect(mark()).toHaveTextContent(
      'Search here to find an open tab fast. Drag the edge to make this wider, or press'
    );
    expect(mark()).toHaveTextContent('to give Open now the whole view.');
    expect(
      screen.queryByRole('img', { name: 'Show the saved session' })
    ).toBeNull();
    expect(mark()).toHaveAttribute('data-coach-step', '2');
  });

  test('folded but peeked: the saved session is beside Open now, so the card names «', async () => {
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
  const GLYPH = 'Save all open windows as a session';
  const TEXT = 'Saved. Press';
  const AGAIN = ' any time to save your windows again.';
  const labels = () =>
    [...document.querySelectorAll('[data-coach-mark] button')].map(
      (b) => b.textContent
    );

  test('the card says it saved, with the glyph; no fine line; Next is the way on', async () => {
    const r = await renderAt(newRun('popup', 1), [
      buildSession({ tabGroupId: 'own', title: 'Own' }),
    ]);
    await screen.findByRole('button', { name: 'Use an example' });
    act(() => {
      r.store.dispatch(takeRunSave('own'));
    });
    await waitFor(() => expect(runOf(r)?.step).toBe(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(runOf(r)?.step).toBe(1));
    expect(mark()).toHaveTextContent(TEXT);
    expect(mark()).toHaveTextContent(AGAIN.trim());
    expect(await screen.findByRole('img', { name: GLYPH })).toBeInTheDocument();
    expect(mark()).not.toHaveTextContent('Saving keeps them safe');
    expect(mark()?.querySelectorAll('p')).toHaveLength(1);
    expect(labels()).toEqual(['Skip tutorial', 'Next']);
    expect(screen.queryByRole('button', { name: 'Use an example' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(runOf(r)?.step).toBe(2));
    expect(r.store.getState().tabContainerDataState.tabGroups).toHaveLength(1);
  });

  test('Use an example, then Back: the card says it is an example, with the glyph; Next adds nothing', async () => {
    const r = await renderAt(newRun('popup', 1), []);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Use an example' })
    );
    await waitFor(() => expect(runOf(r)?.step).toBe(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(runOf(r)?.step).toBe(1));
    expect(mark()).toHaveTextContent('This is an example. Press');
    expect(mark()).toHaveTextContent('any time to save your own windows.');
    expect(mark()).not.toHaveTextContent('Saved.');
    expect(await screen.findByRole('img', { name: GLYPH })).toBeInTheDocument();
    expect(mark()?.querySelectorAll('p')).toHaveLength(1);
    expect(labels()).toEqual(['Skip tutorial', 'Next']);
    const before = r.store.getState().tabContainerDataState.tabGroups.length;
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(runOf(r)?.step).toBe(2));
    expect(r.store.getState().tabContainerDataState.tabGroups).toHaveLength(
      before
    );
  });

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

  test('reduced motion: nothing moves, and the flag still clears', async () => {
    const animate = vi.fn();
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value(this: Element) {
        if (this.matches('[data-tour-anchor="tab-dot"]')) animate();
        return { cancel: () => undefined, finished: Promise.resolve() };
      },
    });
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        new FakeMediaQueryList(
          query,
          query === '(prefers-reduced-motion: reduce)'
        )
    );
    const dot = document.createElement('span');
    dot.setAttribute('data-tour-anchor', 'tab-dot');
    const detail = document.createElement('div');
    detail.setAttribute('data-pane', 'detail');
    detail.append(dot);
    document.body.append(detail);
    try {
      const r = await renderAt(newRun('popup', 1));
      act(() => {
        r.store.dispatch(setRunSaveEcho('own'));
      });
      await waitFor(() =>
        expect(r.store.getState().globalState.runSaveEcho).toBeNull()
      );
      expect(animate).not.toHaveBeenCalled();
    } finally {
      detail.remove();
      Reflect.deleteProperty(Element.prototype, 'animate');
    }
  });
});
