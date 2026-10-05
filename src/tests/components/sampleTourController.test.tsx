import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { advanceSampleTour, startSampleTour } from '../../redux/sampleTour';
import {
  deleteTabInternal,
  openAllTabContainer,
  openTabsInAWindow,
  replaceState,
  requestFocusTabContainer,
  selectTabContainer,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { classRulesFor } from '../setup/hoverRules';
import { toggleWindowCollapse } from '../../redux/slices/globalStateSlice';
import { setPresentStartup, undo } from '../../redux/slices/undoRedoSlice';
import { isSampleSession } from '../../utils/functions/sampleSession';

// KAN-413. The tour's controller in the popup's layout.

const NAMES = {
  title: 'Sample: Weekend trip',
  gettingThere: 'Getting there',
  thingsToDo: 'Things to do',
};
const STEP_1 =
  'A session keeps windows and tabs together. This one has 2 windows and 5 tabs. Fold a window with its arrow.';
// jsdom lays nothing out: every element gets this box, so every anchor is "on screen".
const RECT: DOMRect = {
  x: 400,
  y: 100,
  left: 400,
  top: 100,
  right: 600,
  bottom: 140,
  width: 200,
  height: 40,
  toJSON: () => ({}),
};

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(RECT);
  // Step 1's box is clipped to the windows scroll box's client area, which jsdom reports as 0×0.
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(RECT.width);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(
    RECT.height
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

type Rendered = Awaited<ReturnType<typeof renderWithProviders>>;

async function touring(): Promise<Rendered & { sampleId: string }> {
  const rendered = await renderWithProviders(<MainContainer />, {
    seed: { windows: [{ id: 7 }] },
    seedStore: (store) => {
      store.dispatch(
        replaceState(
          buildContainer([buildSession({ tabGroupId: 'mine', title: 'Mine' })])
        )
      );
      // As App's startup does, so the start's undo step restores this list.
      store.dispatch(
        setPresentStartup({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );
    },
  });
  await act(async () => {
    await rendered.store.dispatch(startSampleTour(NAMES));
  });
  const sampleId =
    rendered.store.getState().settingsDataState.sampleTour?.sampleId ?? '';
  return { ...rendered, sampleId };
}
const mark = () => document.querySelector('[data-coach-mark]');
const atStep = (step: number) =>
  waitFor(() => {
    expect(mark()).toHaveAttribute('data-coach-step', String(step));
    expect(mark()).not.toHaveAttribute('aria-hidden');
  });
function sampleOf(r: Rendered, id: string) {
  const sample = r.store
    .getState()
    .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === id);
  if (sample === undefined) throw new Error('no sample');
  return sample;
}
const escape = () =>
  new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
function detail(): HTMLElement {
  const pane = document.querySelector<HTMLElement>('[data-pane="detail"]');
  if (pane === null) throw new Error('no detail pane');
  return pane;
}

describe('the tour, step by step', () => {
  test('doing each step moves it on; the menu at step 5 opens without taking focus; its Delete ends the tour with no toast', async () => {
    const r = await touring();
    await atStep(1);
    expect(screen.getByRole('dialog', { name: STEP_1 })).toHaveTextContent(
      'Step 1 of 5'
    );

    const sample = sampleOf(r, r.sampleId);
    act(() => {
      r.store.dispatch(
        toggleWindowCollapse({
          tabGroupId: r.sampleId,
          windowId: sample.windows[1].windowId,
        })
      );
    });
    await atStep(2);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await atStep(3);

    act(() => {
      r.store.dispatch(
        updateTabGroupTitle({
          tabGroupId: r.sampleId,
          editableTitle: 'Lisbon in May',
        })
      );
    });
    await atStep(4);

    const sort = screen.getByRole('button', { name: 'Sort sessions' });
    sort.focus();
    const first = sampleOf(r, r.sampleId).windows[0];
    act(() => {
      r.store.dispatch(
        deleteTabInternal({
          tabGroupId: r.sampleId,
          windowId: first.windowId,
          tabId: first.tabs[0].tabId,
        })
      );
    });
    await atStep(5);
    const del = await screen.findByRole('menuitem', { name: 'Delete session' });
    expect(document.activeElement).toBe(sort);

    fireEvent.click(del);
    await waitFor(() =>
      expect(r.store.getState().settingsDataState.sampleTour).toBeNull()
    );
    expect(mark()).toBeNull();
    expect(
      r.store.getState().tabContainerDataState.tabGroups.map((g) => g.title)
    ).toEqual(['Mine']);
    expect(r.store.getState().globalState.toasts).toEqual([]);
    expect(r.store.getState().settingsDataState.lastValueMomentTime).toBe('');
  });

  test('Undo of the start ends the tour quietly', async () => {
    const r = await touring();
    await atStep(1);
    act(() => {
      r.store.dispatch(undo());
    });
    await waitFor(() =>
      expect(r.store.getState().settingsDataState.sampleTour).toBeNull()
    );
    expect(mark()).toBeNull();
  });

  test('an Esc the rename field used cancels the rename, and the tour goes on', async () => {
    const r = await touring();
    act(() => {
      r.store.dispatch(advanceSampleTour());
      r.store.dispatch(advanceSampleTour());
    });
    await atStep(3);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Rename session: Sample: Weekend trip',
      })
    );
    fireEvent.keyDown(screen.getByDisplayValue('Sample: Weekend trip'), {
      key: 'Escape',
    });
    expect(r.store.getState().settingsDataState.sampleTour?.step).toBe(3);
    await atStep(3);
  });

  // Each step is measured from where it began, not from where the tour began.
  test('a later step’s action done early does not skip that step', async () => {
    const r = await touring();
    act(() => {
      r.store.dispatch(advanceSampleTour());
      r.store.dispatch(advanceSampleTour());
    });
    await atStep(3);
    const first = sampleOf(r, r.sampleId).windows[0];
    act(() => {
      r.store.dispatch(
        deleteTabInternal({
          tabGroupId: r.sampleId,
          windowId: first.windowId,
          tabId: first.tabs[0].tabId,
        })
      );
    });
    expect(r.store.getState().settingsDataState.sampleTour?.step).toBe(3);
    act(() => {
      r.store.dispatch(
        updateTabGroupTitle({
          tabGroupId: r.sampleId,
          editableTitle: 'Lisbon in May',
        })
      );
    });
    expect(r.store.getState().settingsDataState.sampleTour?.step).toBe(4);
    await atStep(4);
  });
});

test('another session selected hides the mark and frees Esc; the sample again brings it back', async () => {
  const r = await touring();
  await atStep(1);
  act(() => {
    r.store.dispatch(selectTabContainer('mine'));
  });
  await waitFor(() => expect(mark()).toBeNull());
  const event = escape();
  act(() => {
    document.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(false);
  expect(r.store.getState().settingsDataState.sampleTour).not.toBeNull();
  act(() => {
    r.store.dispatch(selectTabContainer(r.sampleId));
  });
  await atStep(1);
});

test('Esc at step 5 ends the tour and closes the menu it opened; nothing stays open on the next session', async () => {
  const r = await touring();
  act(() => {
    for (let i = 0; i < 4; i += 1) r.store.dispatch(advanceSampleTour());
  });
  await atStep(5);
  expect(await screen.findByRole('menu')).toBeInTheDocument();
  const event = escape();
  act(() => {
    document.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  await waitFor(() =>
    expect(r.store.getState().settingsDataState.sampleTour).toBeNull()
  );
  expect(r.store.getState().tabContainerDataState.selectedTabGroupId).toBe(
    'mine'
  );
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

test('Undo right after Finish: the sample is back as an ordinary session, with no mark', async () => {
  const r = await touring();
  act(() => {
    for (let i = 0; i < 4; i += 1) r.store.dispatch(advanceSampleTour());
  });
  await atStep(5);
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  await waitFor(() =>
    expect(r.store.getState().settingsDataState.sampleTour).toBeNull()
  );
  act(() => {
    r.store.dispatch(undo());
  });
  expect(
    r.store.getState().tabContainerDataState.tabGroups.map((g) => g.title)
  ).toContain('Sample: Weekend trip');
  expect(r.store.getState().settingsDataState.sampleTour).toBeNull();
  expect(mark()).toBeNull();
});

// A step start never reselects the sample, and another session's menu stays shut.
test('step 5 reached with another session on screen: no mark, no menu there; selecting the sample brings both', async () => {
  const r = await touring();
  act(() => {
    for (let i = 0; i < 3; i += 1) r.store.dispatch(advanceSampleTour());
  });
  await atStep(4);
  act(() => {
    r.store.dispatch(selectTabContainer('mine'));
    r.store.dispatch(advanceSampleTour());
  });
  await waitFor(() => expect(mark()).toBeNull());
  expect(r.store.getState().settingsDataState.sampleTour?.step).toBe(5);
  expect(r.store.getState().tabContainerDataState.selectedTabGroupId).toBe(
    'mine'
  );
  expect(screen.queryByRole('menu')).toBeNull();
  act(() => {
    r.store.dispatch(selectTabContainer(r.sampleId));
  });
  await atStep(5);
  expect(await screen.findByRole('menu')).toBeInTheDocument();
});

// CONTROL: the same buttons on the same sample once the tour is over.
const OPEN_BLOCKED = 'Open works after the tour';
const WINDOW_OPENS = [
  `Open in new window: ${NAMES.gettingThere}`,
  `Open in new window: ${NAMES.thingsToDo}`,
];
const OPENS = [
  openAllTabContainer.pending.type,
  requestFocusTabContainer.pending.type,
  openTabsInAWindow.pending.type,
];
test('Open, Switch and each window’s Open on the sample are dimmed, say why and open nothing; after Finish and ⌘Z they open', async () => {
  const r = await touring();
  await atStep(1);
  // The header's Open and Switch take the reason as their name; each window's Open keeps its own.
  const named = within(detail()).getAllByRole('button', { name: OPEN_BLOCKED });
  expect(named).toHaveLength(2);
  const blocked = [
    ...named,
    ...WINDOW_OPENS.map((name) =>
      within(detail()).getByRole('button', { name })
    ),
  ];
  for (const button of blocked) {
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('title', OPEN_BLOCKED);
    expect(classRulesFor(button)).toMatch(/opacity:\s*0\.3/);
    fireEvent.click(button);
  }
  expect(r.seen.filter((type) => OPENS.includes(type))).toEqual([]);

  act(() => {
    for (let i = 0; i < 4; i += 1) r.store.dispatch(advanceSampleTour());
  });
  await atStep(5);
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  await waitFor(() =>
    expect(r.store.getState().settingsDataState.sampleTour).toBeNull()
  );
  act(() => {
    r.store.dispatch(undo());
    r.store.dispatch(selectTabContainer(r.sampleId));
  });
  expect(
    r.store
      .getState()
      .tabContainerDataState.tabGroups.some((g) =>
        isSampleSession(g.tabGroupId)
      )
  ).toBe(true);
  expect(
    within(detail()).queryAllByRole('button', { name: OPEN_BLOCKED })
  ).toEqual([]);
  for (const name of [
    'Open session, keeping current windows',
    'Close current windows and open this session',
    WINDOW_OPENS[0],
  ]) {
    const button = within(detail()).getByRole('button', { name });
    expect(button).not.toHaveAttribute('aria-disabled');
    fireEvent.click(button);
  }
  for (const type of OPENS) expect(r.seen).toContain(type);
});
