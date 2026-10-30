import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useSelector } from 'react-redux';

import EndingCard from '../../components/tour/EndingCard';
import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import { ringBox, type Box } from '../../components/tour/coachMarkPlacement';
import { useEndingRelease } from '../../hooks/useEndingRelease';
import { REVIEW_CARD_SETTLE_MS } from '../../hooks/useReviewAskRelease';
import { requestEnding } from '../../redux/onboardingEnding';
import { finishRunHere, leaveReplayNote, startRun } from '../../redux/firstRun';
import { leaveSetup } from '../../redux/firstOpenFollowUps';
import { showInFullView } from '../../redux/fullViewShow';
import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  closeFullViewCallout,
  closePinGuide,
  closeReplayNote,
  closeReviewCard,
  closeSettingsPage,
  closeSetup,
  openFullViewCallout,
  openPinGuide,
  openReplayNote,
  openReviewCard,
  openSettingsPage,
  openSetup,
  runShownHere,
  runStoppedHere,
  setFirstSavePopping,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { newReplayRun, newRun } from '../../utils/functions/firstRun';
import type { RootState } from '../../redux/store';

// KAN-879. The onboarding ending: at the saved row's Open (or Save with none), once nothing covers the page.

type Store = RenderWithProvidersResult['store'];

const OPEN: Box = { left: 500, top: 200, width: 60, height: 30 };
const SAVE: Box = { left: 40, top: 20, width: 200, height: 30 };
const rect = ({ left, top, width, height }: Box): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  toJSON: () => ({}),
});
const BOX_OF: Record<string, Box> = { 'row-open': OPEN, save: SAVE };

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      const box = BOX_OF[this.getAttribute('data-tour-anchor') ?? ''];
      return rect(box ?? { left: 0, top: 0, width: 0, height: 0 });
    }
  );
});
afterEach(() => {
  // A failed test's modal would claim the next test's Esc.
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  localStorage.clear();
  vi.restoreAllMocks();
});

const TRIP = buildSession({ tabGroupId: 'trip', title: 'Lisbon trip' });
const OTHER = buildSession({ tabGroupId: 'other', title: 'Other' });

// The sessions pane as the page draws it: Save, then each row by id.
function Page() {
  useEndingRelease(true);
  const sessions = useSelector(
    (state: RootState) => state.tabContainerDataState.tabGroups
  );
  return (
    <>
      <div data-pane="sessions">
        <button type="button" data-tour-anchor="save">
          Save
        </button>
        {sessions.map((session) => (
          <div key={session.tabGroupId} data-drag-row-id={session.tabGroupId}>
            <TabGroupEntry
              tabGroupData={session}
              onTabGroupClick={() => undefined}
              onOpenAllClick={() => undefined}
              onFocusClick={() => undefined}
              onReplaceClick={() => undefined}
              onDeleteKey={() => undefined}
              deleteKeyShortcuts="Delete Backspace"
            />
          </div>
        ))}
      </div>
      <EndingCard />
    </>
  );
}

// A finished popup run that saved TRIP under a name the user typed.
const typedRun = (store: Store) => {
  store.dispatch(replaceState(buildContainer([OTHER, TRIP])));
  store.dispatch(
    recordFirstRun({
      ...newRun('popup', 8),
      sessionId: 'trip',
      ended: 'finished',
      isSessionNameTyped: true,
    })
  );
};

async function renderPending(seed: (store: Store) => void = typedRun) {
  const r = await renderWithProviders(<Page />, {
    seedStore: (store) => {
      seed(store);
      store.dispatch(requestEnding());
    },
  });
  return r;
}

const mark = () => document.querySelector<HTMLElement>('[data-coach-mark]');
const ring = () => document.querySelector<HTMLElement>('[data-coach-ring]');
const placed = () =>
  waitFor(() => {
    expect(mark()).not.toBeNull();
    expect(mark()).not.toHaveAttribute('aria-hidden');
  });
const settled = () =>
  act(
    () =>
      new Promise<void>((done) => setTimeout(done, REVIEW_CARD_SETTLE_MS + 100))
  );
const endingOf = (store: Store) => store.getState().globalState.endingCard;
const linesOf = () => {
  const text = mark()?.querySelector('p');
  return {
    text: text?.textContent,
    breaks: text?.querySelectorAll('br').length,
  };
};
// The ring sits around the anchor the card points at.
const ringsAt = (box: Box) => {
  const at = ringBox(box);
  expect(ring()?.style.left).toBe(`${at.left}px`);
  expect(ring()?.style.top).toBe(`${at.top}px`);
};
const tripRow = () =>
  document.querySelector('[data-drag-row-id="trip"] > [data-drag-handle-row]');

describe('the ending card', () => {
  test('once nothing covers the page: the typed name, at the row’s Open, with Got it', async () => {
    const { store } = await renderPending();
    await placed();
    expect(endingOf(store)).toBe('shown');
    expect(linesOf()).toEqual({
      text:
        "You're all set. Lisbon trip is saved." +
        'Open brings its tabs back, any time.' +
        'Have a good day!',
      breaks: 2,
    });
    expect(screen.getByRole('button', { name: 'Got it' })).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
    ringsAt(OPEN);
    expect(tripRow()).toHaveAttribute('data-run-engaged');
    expect(
      document.querySelector('[data-drag-row-id="other"] [data-run-engaged]')
    ).toBeNull();
  });

  test('no dim: the page around it is left as it is, its Open included', async () => {
    await renderPending();
    await placed();
    expect(document.querySelector('[data-coach-dim]')).toBeNull();
    expect(document.querySelector('[data-coach-still]')).toBeNull();
  });

  test('no saved session: at the save button, saying to save here', async () => {
    await renderPending((store) =>
      store.dispatch(replaceState(buildContainer([])))
    );
    await placed();
    expect(linesOf()).toEqual({
      text:
        "You're all set." +
        'Save your tabs here whenever you like.' +
        'Have a good day!',
      breaks: 2,
    });
    ringsAt(SAVE);
  });

  test('a row scrolled out of the list is brought into view, nearest edge', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    await renderPending();
    await placed();
    expect(scroll).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'nearest' })
    );
    expect(scroll.mock.contexts[0]).toBe(
      document.querySelector(
        '[data-drag-row-id="trip"] [data-tour-anchor="row-open"]'
      )
    );
  });

  const COVERS: [string, (s: Store) => void, (s: Store) => void][] = [
    [
      'the pin guide',
      (s) => s.dispatch(openPinGuide()),
      (s) => s.dispatch(closePinGuide()),
    ],
    ['setup', (s) => s.dispatch(openSetup()), (s) => s.dispatch(closeSetup())],
    [
      'the replay note',
      (s) =>
        s.dispatch(
          openReplayNote({
            leadsToSetup: false,
            leadsToEnding: false,
            isAfterHelpTour: false,
          })
        ),
      (s) => s.dispatch(closeReplayNote()),
    ],
    [
      'the first-save pop',
      (s) => s.dispatch(setFirstSavePopping(true)),
      (s) => s.dispatch(setFirstSavePopping(false)),
    ],
    [
      'the full-view callout',
      (s) => s.dispatch(openFullViewCallout()),
      (s) => s.dispatch(closeFullViewCallout()),
    ],
    [
      'a run here',
      (s) => s.dispatch(runShownHere()),
      (s) => s.dispatch(runStoppedHere()),
    ],
  ];
  test.each(COVERS)(
    'waits while %s covers the page',
    async (_, cover, uncover) => {
      const { store } = await renderPending((s) => {
        typedRun(s);
        cover(s);
      });
      await settled();
      expect(mark()).toBeNull();
      expect(endingOf(store)).toBe('pending');
      act(() => uncover(store));
      await placed();
      expect(endingOf(store)).toBe('shown');
    }
  );

  test('waits while a modal dialog is open', async () => {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    const { store } = await renderPending();
    await settled();
    expect(mark()).toBeNull();
    expect(endingOf(store)).toBe('pending');
    dialog.close();
    dialog.remove();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await placed();
  });

  // Help → Show pin guide, or a first save at Save, can open over it.
  test.each(
    COVERS.filter(([name]) =>
      ['the pin guide', 'the first-save pop'].includes(name)
    )
  )(
    'hides while %s covers the page, and comes back after',
    async (_, cover, uncover) => {
      const { store } = await renderPending();
      await placed();
      act(() => cover(store));
      expect(mark()).toBeNull();
      expect(tripRow()).not.toHaveAttribute('data-run-engaged');
      act(() => uncover(store));
      await placed();
      ringsAt(OPEN);
    }
  );

  test('waits while the review card shows, and shows once it closes', async () => {
    const { store } = await renderPending((s) => {
      typedRun(s);
      s.dispatch(
        openReviewCard({ moment: { kind: 'time' }, offersNever: false })
      );
    });
    await settled();
    expect(mark()).toBeNull();
    expect(endingOf(store)).toBe('pending');
    act(() => {
      store.dispatch(closeReviewCard());
    });
    await placed();
    expect(endingOf(store)).toBe('shown');
  });

  test('a long name typed with no spaces wraps inside the card', async () => {
    const long = 'x'.repeat(120);
    await renderPending((store) => {
      typedRun(store);
      store.dispatch(replaceState(buildContainer([{ ...TRIP, title: long }])));
    });
    await placed();
    expect(linesOf().text).toContain(`${long} is saved.`);
    expect(mark()?.querySelector('p > span')).toHaveStyle({
      overflowWrap: 'anywhere',
    });
  });

  test.each([
    [
      'Got it',
      () => fireEvent.click(screen.getByRole('button', { name: 'Got it' })),
    ],
    ['Esc', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ])('%s closes it for good', async (_, press) => {
    const { store } = await renderPending();
    await placed();
    press();
    await waitFor(() => expect(mark()).toBeNull());
    expect(endingOf(store)).toBeNull();
    expect(store.getState().settingsDataState.isPopupEndingSeen).toBe(true);
    expect(tripRow()).not.toHaveAttribute('data-run-engaged');
    await settled();
    expect(mark()).toBeNull();
  });

  test('hides while a search is active and shows when it clears, search text untouched', async () => {
    const { store } = await renderPending();
    await placed();
    act(() => {
      store.dispatch(setSearchInputText('lis'));
    });
    expect(mark()).toBeNull();
    expect(store.getState().globalState.searchInputText).toBe('lis');
    expect(endingOf(store)).toBe('shown');
    act(() => {
      store.dispatch(setSearchInputText(''));
    });
    await placed();
    ringsAt(OPEN);
  });

  test('falls through to the save button when the session goes', async () => {
    const { store } = await renderPending();
    await placed();
    ringsAt(OPEN);
    act(() => {
      store.dispatch(replaceState(buildContainer([])));
    });
    await waitFor(() =>
      expect(linesOf().text).toBe(
        "You're all set." +
          'Save your tabs here whenever you like.' +
          'Have a good day!'
      )
    );
    await waitFor(() => ringsAt(SAVE));
  });

  test('hidden on the Settings page, back on return', async () => {
    const { store } = await renderPending();
    await placed();
    await act(async () => {
      await store.dispatch(openSettingsPage(undefined));
    });
    expect(mark()).toBeNull();
    expect(endingOf(store)).toBe('shown');
    act(() => {
      store.dispatch(closeSettingsPage());
    });
    await placed();
    ringsAt(OPEN);
  });

  // Not marked seen where it cannot be seen. The request lives in this page only: a page closed while it waits loses it.
  test.each([
    [
      'on the Settings page',
      async (s: Store) => {
        await s.dispatch(openSettingsPage(undefined));
      },
      (s: Store) => s.dispatch(closeSettingsPage()),
    ],
    [
      'during a search',
      (s: Store) => s.dispatch(setSearchInputText('lis')),
      (s: Store) => s.dispatch(setSearchInputText('')),
    ],
  ])(
    'asked for %s, it waits, unseen, until it can show',
    async (_, go, back) => {
      const { store } = await renderWithProviders(<Page />, {
        seedStore: typedRun,
      });
      await act(async () => {
        await go(store);
        store.dispatch(requestEnding());
      });
      await settled();
      expect(endingOf(store)).toBe('pending');
      expect(store.getState().settingsDataState.isPopupEndingSeen).toBe(false);
      act(() => {
        back(store);
      });
      await placed();
      expect(store.getState().settingsDataState.isPopupEndingSeen).toBe(true);
    }
  );
});

// Never on a replay: Help's tour or setup, started while it shows or waits, takes it away for good.
describe('a Help replay takes the ending away', () => {
  let locks: FakeLocks;
  beforeEach(() => {
    locks = installFakeLocks();
  });
  afterEach(() => {
    locks.uninstall();
    history.replaceState(null, '', '?');
  });

  const run = (step: (s: Store) => unknown) => (store: Store) =>
    act(async () => {
      await step(store);
    });
  const toHelp = run((s) =>
    s.dispatch(openSettingsPage(SettingsCategory.HELP))
  );

  // Shown, then Help; or asked for while on Settings, so still waiting.
  const AT_HELP = ['shown', 'pending'] as const;
  const renderAtHelp = async (at: (typeof AT_HELP)[number]) => {
    const { store } = await renderWithProviders(<Page />, {
      seedStore: typedRun,
    });
    if (at === 'pending') await toHelp(store);
    act(() => {
      store.dispatch(requestEnding());
    });
    if (at === 'shown') {
      await placed();
      await toHelp(store);
    }
    await settled();
    expect(endingOf(store)).toBe(at);
    return store;
  };
  const expectGone = async (store: Store) => {
    await settled();
    expect(mark()).toBeNull();
    expect(endingOf(store)).toBeNull();
  };

  test.each(AT_HELP)(
    'popup, %s: Show me around, the replay finished and its note closed: no card',
    async (at) => {
      const store = await renderAtHelp(at);
      await run((s) => s.dispatch(startRun(newReplayRun('popup'))))(store);
      await run((s) => s.dispatch(finishRunHere()))(store);
      await run((s) => s.dispatch(leaveReplayNote()))(store);
      await expectGone(store);
    }
  );

  test.each(AT_HELP)(
    'full view, %s: Show me around, then its note, setup and the pin guide: no card',
    async (at) => {
      history.replaceState(null, '', '?view=tab');
      const store = await renderAtHelp(at);
      await run((s) => s.dispatch(startRun(newReplayRun('full'))))(store);
      await run((s) => s.dispatch(finishRunHere()))(store);
      await run((s) => s.dispatch(leaveReplayNote()))(store);
      expect(store.getState().globalState.isSetupOpen).toBe(true);
      await run((s) => s.dispatch(leaveSetup()))(store);
      act(() => {
        store.dispatch(closePinGuide());
      });
      await expectGone(store);
    }
  );

  test.each(AT_HELP)(
    'full view, %s: Run setup again, then leaving setup: no card',
    async (at) => {
      history.replaceState(null, '', '?view=tab');
      const store = await renderAtHelp(at);
      await run((s) => s.dispatch(showInFullView('setup')))(store);
      expect(store.getState().globalState.isSetupOpen).toBe(true);
      await run((s) => s.dispatch(leaveSetup()))(store);
      await expectGone(store);
    }
  );
});
