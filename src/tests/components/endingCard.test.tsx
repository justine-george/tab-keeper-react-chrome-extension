import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useSelector } from 'react-redux';

import EndingCard from '../../components/tour/EndingCard';
import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import { ringBox, type Box } from '../../components/tour/coachMarkPlacement';
import { useEndingRelease } from '../../hooks/useEndingRelease';
import { REVIEW_CARD_SETTLE_MS } from '../../hooks/useReviewAskRelease';
import { requestEnding } from '../../redux/onboardingEnding';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  closeFullViewCallout,
  closePinGuide,
  closeReplayNote,
  closeSettingsPage,
  closeSetup,
  openFullViewCallout,
  openPinGuide,
  openReplayNote,
  openSettingsPage,
  openSetup,
  runShownHere,
  runStoppedHere,
  setFirstSavePopping,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { newRun } from '../../utils/functions/firstRun';
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
          openReplayNote({ leadsToSetup: false, leadsToEnding: false })
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

  // A Help tour can start while it shows; a first save under it pops.
  test.each(COVERS)(
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

  // Not marked seen where it cannot be seen: a page closed on Settings or mid-search gets it next time.
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
