import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

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
import {
  recordFirstRun,
  setDefaultView,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { firstOpenDialogs } from '../../redux/firstOpenDialogs';
import { newRun, type FirstRun as Run } from '../../utils/functions/firstRun';
import { OPEN_IN_TAB_MESSAGE } from '../../utils/functions/popOut';

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
    '<span data-tour-anchor="compact"></span>' +
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

const WHATS_NEW = "What's new in Tab Keeper 2.0";

// KAN-623. The popup's open-time queue for an upgrader, as App runs it.
async function openPopupAs(storedAtOpen: Partial<SettingsData>) {
  const r = await renderWithProviders(<FirstRun />, {
    seed: SEED,
    seedStore: (store) => store.dispatch(replaceState(buildContainer([OWN()]))),
  });
  if (storedAtOpen.firstRun) {
    r.store.dispatch(recordFirstRun(storedAtOpen.firstRun));
  }
  const entry = firstOpenDialogs('popup', {
    dispatch: r.store.dispatch,
    storedAtOpen,
    storedSessions: 1,
    getState: r.store.getState,
  }).find((e) => e.id === 'firstRun');
  const open = await entry?.decide();
  await act(async () => {
    if (typeof open === 'function') open();
    await Promise.resolve();
  });
  return r;
}

describe('the controller', () => {
  test('KAN-623: the full view’s What’s new is seen on Start, not when it shows', async () => {
    history.replaceState(null, '', '?view=tab');
    const r = await renderAt(newRun('full', 0, 'whatsNew'));
    expect(screen.getByRole('dialog', { name: WHATS_NEW })).toBeVisible();
    expect(r.store.getState().settingsDataState.isWhatsNew2Seen).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(r.store.getState().settingsDataState.isWhatsNew2Seen).toBe(true);
    expect(runOf(r)?.step).toBe(1);
  });

  test('KAN-623: an upgrader’s popup opens What’s new, not the welcome, unseen until answered', async () => {
    const r = await openPopupAs({ cloudConsent: 'declined' });
    expect(
      await screen.findByRole('dialog', { name: WHATS_NEW })
    ).toBeVisible();
    expect(r.store.getState().globalState.isCloudConsentModalOpen).toBe(false);
    expect(runOf(r)).toEqual(newRun('popup', 0, 'whatsNew'));
    expect(r.store.getState().settingsDataState.isWhatsNew2Seen).toBe(false);
  });

  test('KAN-623: Start in the popup records the full view’s step 1 and asks for the tab', async () => {
    const r = await openPopupAs({ cloudConsent: 'declined' });
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(runOf(r)).toEqual(newRun('full', 1, 'whatsNew'))
    );
    await waitFor(() =>
      expect(r.chrome.sentMessages).toContainEqual(
        expect.objectContaining({ type: OPEN_IN_TAB_MESSAGE })
      )
    );
    expect(r.store.getState().settingsDataState.isWhatsNew2Seen).toBe(true);
    expect(r.store.getState().globalState.isRunHere).toBe(false);
  });

  test('KAN-623: Skip tutorial in the popup ends the run skipped, with the replay note', async () => {
    const r = await openPopupAs({ cloudConsent: 'declined' });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Skip tutorial' })
    );
    expect(runOf(r)?.ended).toBe('skipped');
    expect(r.store.getState().globalState.isReplayNoteOpen).toBe(true);
    expect(r.store.getState().settingsDataState.isWhatsNew2Seen).toBe(true);
    expect(r.store.getState().settingsDataState.isFullViewCalloutSeen).toBe(
      true
    );
    expect(r.chrome.sentMessages).not.toContainEqual(
      expect.objectContaining({ type: OPEN_IN_TAB_MESSAGE })
    );
  });

  test('KAN-623: an unanswered What’s new comes back on the next popup open, counted, and not as the welcome', async () => {
    const r = await openPopupAs({
      cloudConsent: 'declined',
      firstRun: { ...newRun('popup', 0, 'whatsNew'), welcomeShows: 2 },
    });
    expect(
      await screen.findByRole('dialog', { name: WHATS_NEW })
    ).toBeVisible();
    expect(runOf(r)?.welcomeShows).toBe(3);
    expect(r.store.getState().globalState.isCloudConsentModalOpen).toBe(false);
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
        startRun({ ...newRun('full', 9), sessionId: 'own' })
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
        startRun({ ...newRun('full', 9), sessionId: 'own' })
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

const COMPACT_TEXT =
  'Your compact view is still here. Click Tab Keeper in the toolbar as always, or Open compact view to switch back.';
const COMPACT_SHORT =
  'Your compact view is still here. Click Tab Keeper in the toolbar as always.';
const FROM_POPUP = newRun('full', 0, 'whatsNew', 'popup');

// The card at full step 0; action: {} is Chrome 127+, where the full view draws ⤡.
async function renderCard(action: { hasOpenPopup?: boolean } = {}) {
  const r = await renderWithProviders(<FirstRun />, {
    seed: { ...SEED, action },
    seedStore: (store) => store.dispatch(replaceState(buildContainer([OWN()]))),
  });
  await act(async () => {
    await r.store.dispatch(startRun(FROM_POPUP));
  });
  return r;
}

describe('KAN-623: the compact-view card', () => {
  beforeEach(() => history.replaceState(null, '', '?view=tab'));

  test('a run from the popup opens on the card under ⤡: no Hello, no progress line', async () => {
    await renderCard();
    const card = await screen.findByRole('dialog', { name: COMPACT_TEXT });
    expect(card).toHaveAttribute('data-coach-kind', 'compactView');
    await waitFor(() =>
      expect(card).toHaveAttribute('data-coach-side', 'below')
    );
    expect(screen.queryByRole('dialog', { name: WHATS_NEW })).toBeNull();
    expect(within(card).queryByRole('progressbar')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Back' })).toBeNull();
    expect(
      within(card).getByRole('img', { name: 'Open compact view' })
    ).toHaveTextContent('close_fullscreen');
  });

  test('Next goes to step 1, which counts 1 of 9', async () => {
    const r = await renderCard();
    await screen.findByRole('dialog', { name: COMPACT_TEXT });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(runOf(r)?.step).toBe(1));
    expect(await screen.findByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Step 1 of 9'
    );
  });

  test.each([
    [
      'Skip tutorial',
      () =>
        fireEvent.click(screen.getByRole('button', { name: 'Skip tutorial' })),
    ],
    ['Esc', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ])('%s ends the run skipped, with the replay note', async (_name, press) => {
    const r = await renderCard();
    await screen.findByRole('dialog', { name: COMPACT_TEXT });
    await waitFor(() => expect(mark()).not.toHaveAttribute('aria-hidden'));
    press();
    expect(runOf(r)?.ended).toBe('skipped');
    expect(r.store.getState().globalState.isReplayNoteOpen).toBe(true);
  });

  test('no ⤡ before Chrome 127: the short text', async () => {
    // The header draws no ⤡ here.
    document.querySelector('[data-tour-anchor="compact"]')?.remove();
    await renderCard({ hasOpenPopup: false });
    await waitFor(() => expect(mark()).toHaveTextContent(COMPACT_SHORT));
    // Placed where step 9's card sits, not waiting on an anchor that never comes.
    await waitFor(() =>
      expect(mark()).toHaveAttribute('data-coach-side', 'free')
    );
    expect(mark()).not.toHaveTextContent('switch back');
  });

  test('default view changed to Full while it shows: the short text, never a lost anchor', async () => {
    const r = await renderCard();
    await screen.findByRole('dialog', { name: COMPACT_TEXT });
    act(() => {
      r.store.dispatch(setDefaultView('full'));
    });
    // The header takes ⤡ away with it.
    document.querySelector('[data-tour-anchor="compact"]')?.remove();
    expect(mark()).toHaveTextContent(COMPACT_SHORT);
    await waitFor(() =>
      expect(mark()).toHaveAttribute('data-coach-side', 'free')
    );
  });

  test('a run the full view started itself shows the Hello, not the card', async () => {
    await renderAt(newRun('full', 0, 'whatsNew'));
    expect(screen.getByRole('dialog', { name: WHATS_NEW })).toBeVisible();
    expect(
      document.querySelector('[data-coach-kind="compactView"]')
    ).toBeNull();
  });
});
