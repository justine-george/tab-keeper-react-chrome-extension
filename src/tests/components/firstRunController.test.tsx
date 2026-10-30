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
  setDefaultSaveScope,
  setDefaultView,
  setFoldOpenNowInTabView,
  setPinTabKeeperInNewWindows,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { firstOpenDialogs } from '../../redux/firstOpenDialogs';
import {
  newFullViewStepsRun,
  newRun,
  type FirstRun as Run,
} from '../../utils/functions/firstRun';
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

  test('KAN-623: Start in the popup records the full view’s compact-view card and asks for the tab', async () => {
    const r = await openPopupAs({ cloudConsent: 'declined' });
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(runOf(r)).toEqual(newRun('full', 0, 'whatsNew', 'popup'))
    );
    await waitFor(() =>
      expect(r.chrome.sentMessages).toContainEqual(
        expect.objectContaining({ type: OPEN_IN_TAB_MESSAGE })
      )
    );
    expect(r.store.getState().settingsDataState.isWhatsNew2Seen).toBe(true);
    expect(r.store.getState().globalState.isRunHere).toBe(false);
  });

  test('KAN-623: with Full view as the default, Start records step 1: the toolbar opens the full view, so no card', async () => {
    const r = await openPopupAs({ cloudConsent: 'declined' });
    act(() => {
      r.store.dispatch(setDefaultView('full'));
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(runOf(r)).toEqual(newRun('full', 1, 'whatsNew', 'popup'))
    );
  });

  test('KAN-623: the popup’s Start shows ⤢ first; its name stays Start', async () => {
    await openPopupAs({ cloudConsent: 'declined' });
    const start = await screen.findByRole('button', { name: 'Start' });
    expect(start.firstElementChild).toHaveTextContent('open_in_full');
    expect(start).toHaveAccessibleName('Start');
  });

  test('KAN-623: the full view’s own Start opens no tab, so it has no ⤢', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderAt(newRun('full', 0, 'whatsNew'));
    expect(screen.getByRole('button', { name: 'Start' })).not.toHaveTextContent(
      'open_in_full'
    );
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
  // KAN-500. The grip needs a window of 1100px or wider; jsdom's own is 1024px.
  const ORIGINAL_INNER_WIDTH = window.innerWidth;
  const widthOf = (px: number) => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: px,
    });
    window.dispatchEvent(new Event('resize'));
  };
  afterEach(() => widthOf(ORIGINAL_INNER_WIDTH));

  test('folded but peeked: the saved session is beside Open now, so the card names the fold glyph', async () => {
    widthOf(1400);
    history.replaceState(null, '', '?view=tab');
    const r = await renderAt(newRun('full', 2));
    act(() => {
      r.store.dispatch(peekSavedSession());
    });
    const glyph = await screen.findByRole('img', {
      name: 'Fold the saved session away',
    });
    // KAN-794. The button's own glyph.
    expect(glyph.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe(
      'left_panel_close'
    );
    expect(mark()).toHaveTextContent('Drag the edge');
  });

  // KAN-808. Folded by the saved session's button, Open now is the rail in a
  // wide window: the card points at the rail, and does not blame the window.
  test("Open now folded to its rail: the rail's card, without the narrow window", async () => {
    widthOf(1400);
    history.replaceState(null, '', '?view=tab');
    const r = await renderAt(newRun('full', 2));
    act(() => {
      r.store.dispatch(setFoldOpenNowInTabView(true));
    });
    await waitFor(() =>
      expect(mark()).toHaveTextContent('Currently open is tucked in here.')
    );
    expect(mark()).not.toHaveTextContent('narrow');
    expect(mark()).not.toHaveTextContent('Drag the edge');
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

// KAN-635. The save card shows the button Default save puts on the row.
describe('the save card’s glyph follows Default save', () => {
  test.each([
    ['all-windows', 'Save all open windows as a session', 'two_windows_add'],
    ['current-window', 'Save current window as a session', 'window_add'],
  ] as const)('%s: %s', async (scope, name, glyph) => {
    const r = await renderAt({ ...newRun('popup', 1), sessionId: 'own' });
    act(() => {
      r.store.dispatch(setDefaultSaveScope(scope));
    });
    const card = await screen.findByRole('button', { name: 'Next' });
    const img = within(mark() as HTMLElement).getByRole('img', { name });
    expect(card).toBeVisible();
    expect(img.querySelector('[data-icon]')).toHaveAttribute(
      'data-icon',
      glyph
    );
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
        // An EventTarget, as an Animation is: the card listens for its end (KAN-654).
        return Object.assign(new EventTarget(), {
          cancel: () => undefined,
          finished: Promise.resolve(),
        });
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

describe('KAN-830: the short full-view tour', () => {
  beforeEach(() => history.replaceState(null, '', '?view=tab'));

  const progress = () => screen.getByRole('progressbar');
  // Placed: an unplaced card is aria-hidden, so its progressbar has no role yet.
  const shown = (step: string) =>
    waitFor(() => {
      expect(mark()).toHaveAttribute('data-coach-step', step);
      expect(mark()).not.toHaveAttribute('aria-hidden');
    });
  const next = async (step: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await shown(step);
  };

  test('Currently open, Find & fit, Two views count 1, 2, 3 of 3; Back from Two views is Find & fit', async () => {
    const r = await renderAt(newFullViewStepsRun(null));
    await shown('1');
    expect(mark()).toHaveAttribute('data-coach-kind', 'openNow');
    expect(progress()).toHaveAttribute('aria-valuetext', 'Step 1 of 3');
    expect(progress()).toHaveAttribute('aria-valuemax', '3');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    await next('2');
    expect(mark()).toHaveAttribute('data-coach-kind', 'findAndFit');
    expect(progress()).toHaveAttribute('aria-valuetext', 'Step 2 of 3');
    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible();
    await next('9');
    expect(mark()).toHaveAttribute('data-coach-kind', 'twoViews');
    expect(progress()).toHaveAttribute('aria-valuetext', 'Step 3 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(runOf(r)?.step).toBe(2));
    await next('9');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(runOf(r)?.ended).toBe('finished'));
  });

  test('Esc on its first card skips; on Two views, its last, it finishes', async () => {
    const first = await renderAt(newFullViewStepsRun(null));
    await waitFor(() => expect(mark()).not.toHaveAttribute('aria-hidden'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(runOf(first)?.ended).toBe('skipped');
    first.unmount();
    const last = await renderAt({ ...newFullViewStepsRun(null), step: 9 });
    await waitFor(() => expect(mark()).not.toHaveAttribute('aria-hidden'));
    expect(screen.queryByRole('button', { name: 'Skip tutorial' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(runOf(last)?.ended).toBe('finished');
  });

  // CONTROL: the whole tour still counts of 9.
  test('a whole run at step 1 still reads 1 of 9', async () => {
    await renderAt(newRun('full', 1));
    await shown('1');
    expect(progress()).toHaveAttribute('aria-valuetext', 'Step 1 of 9');
  });
});

describe('KAN-878: a tour without the pin card', () => {
  beforeEach(() => {
    history.replaceState(null, '', '?view=tab');
    const detail = document.createElement('div');
    detail.dataset.pane = 'detail';
    detail.innerHTML =
      '<div data-tour-anchor="windows"><div data-drag-row-id="w1"></div></div>';
    for (const element of [detail, ...detail.querySelectorAll('*')]) {
      (element as HTMLElement).getBoundingClientRect = () => RECT;
    }
    anchors.append(detail);
  });
  // A full-view page on its own tab, pinned, with "pin in new windows" as given.
  async function renderPinnedAt(run: Run, pinsInNewWindows: boolean) {
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
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([OWN()])));
        store.dispatch(setPinTabKeeperInNewWindows(pinsInNewWindows));
      },
    });
    await act(async () => {
      await r.store.dispatch(startRun(run));
    });
    await waitFor(() => expect(mark()).not.toBeNull());
    return r;
  }
  // jsdom never places the card, so it stays aria-hidden: read its buttons and line from the DOM.
  const cardButtons = () =>
    [...document.querySelectorAll('[data-coach-mark] button')].map(
      (b) => b.textContent
    );
  const button = (name: string) =>
    waitFor(() => {
      const found = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[data-coach-mark] button'
        ),
      ].find((b) => b.textContent === name);
      if (found === undefined) throw new Error(`no ${name} in the card`);
      return found;
    });
  const count = () =>
    document
      .querySelector('[data-coach-mark] [role="progressbar"]')
      ?.getAttribute('aria-valuetext');

  test('the windows card is last: 8 of 8, Done, no Skip tutorial', async () => {
    await renderPinnedAt({ ...newRun('full', 8), sessionId: 'own' }, true);
    await button('Done');
    expect(count()).toBe('Step 8 of 8');
    expect(cardButtons()).not.toContain('Next');
    expect(cardButtons()).not.toContain('Skip tutorial');
  });

  test('Done finishes the run, as Not now does, and the replay note follows', async () => {
    const r = await renderPinnedAt(
      { ...newRun('full', 8), sessionId: 'own' },
      true
    );
    fireEvent.click(await button('Done'));
    await waitFor(() => expect(runOf(r)?.ended).toBe('finished'));
    expect(r.store.getState().globalState.isReplayNoteOpen).toBe(true);
  });

  test('the short tour ends on Find & fit: 2 of 2, Done', async () => {
    await renderPinnedAt({ ...newFullViewStepsRun(null), step: 2 }, true);
    await button('Done');
    expect(count()).toBe('Step 2 of 2');
  });

  test('pinned with the setting off: 8 of 9 with Next, and the pin card after', async () => {
    await renderPinnedAt({ ...newRun('full', 8), sessionId: 'own' }, false);
    fireEvent.click(await button('Next'));
    expect(await button('Pin this tab')).toBeTruthy();
    expect(count()).toBe('Step 9 of 9');
  });

  test('counted cards wait for the decision, so 8 of 9 never shows', async () => {
    let answer: (tab: chrome.tabs.Tab) => void = () => undefined;
    const counts: (string | null)[] = [];
    const seen = new MutationObserver(() => {
      const line = document.querySelector('[role="progressbar"]');
      if (line) counts.push(line.getAttribute('aria-valuetext'));
    });
    seen.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    const r = await renderWithProviders(<FirstRun />, {
      seed: { ...SEED, currentTabId: 7 },
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([OWN()])));
        store.dispatch(setPinTabKeeperInNewWindows(true));
      },
    });
    vi.spyOn(chrome.tabs, 'getCurrent').mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }) as unknown as ReturnType<typeof chrome.tabs.getCurrent>
    );
    await act(async () => {
      await r.store.dispatch(
        startRun({ ...newRun('full', 8), sessionId: 'own' })
      );
    });
    expect(mark()).toBeNull();
    await act(async () => {
      answer({ id: 7, pinned: true } as chrome.tabs.Tab);
    });
    await button('Done');
    seen.disconnect();
    expect(counts).not.toContain('Step 8 of 9');
    expect(count()).toBe('Step 8 of 8');
  });
});
