import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { TYPE } from '../../styles/scale';
import { OPEN_NOW_RAIL_QUERY } from '../../components/home/opennow/railQuery';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-280 O2. Below 1100px, side by side, Open now's column is a 44px rail
// with one button, and the button opens Open now as a drawer over the right
// side. Folded, Open now is in the detail column at any width, so no rail.

const RAIL_NAME = 'Open now, 3 Tabs';
const CLOSE = 'Close Open now';
// Only the pane renders this line, so its presence is the pane's.
const PANE_ONLY = 'Updates as you browse';
// Only HeroContainerRight renders this, so its presence is the saved detail's.
const HERO_ONLY = 'Open session, keeping current windows';

// Two windows, three tabs.
const twoWindows = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [{ title: 'A', url: 'https://a.test/', active: true }],
    },
    {
      id: 2,
      focused: false,
      tabs: [
        { title: 'B', url: 'https://b.test/', active: false },
        { title: 'C', url: 'https://c.test/', active: true },
      ],
    },
  ],
});

// The rail's query as the page sees it. Every other query answers false.
let railQuery: FakeMediaQueryList;

function installMatchMedia(narrow: boolean) {
  railQuery = new FakeMediaQueryList(OPEN_NOW_RAIL_QUERY, narrow);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query === OPEN_NOW_RAIL_QUERY
      ? railQuery
      : new FakeMediaQueryList(query, false)
  );
}

const renderHome = (fold: boolean) =>
  renderWithProviders(<MainContainer />, {
    seed: twoWindows(),
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: 'first', title: 'First session' })
        )
      );
      store.dispatch(selectTabContainer('first'));
      store.dispatch(setFoldSavedSessionInTabView(fold));
    },
  });

const openNowSlot = () => {
  const slot = document.querySelector<HTMLElement>('[data-pane="open-now"]');
  if (slot === null) throw new Error('no Open now slot');
  return slot;
};

const railButton = () => screen.findByRole('button', { name: RAIL_NAME });

// The drawer the rail button says it controls.
function drawerOf(button: HTMLElement): HTMLElement {
  const id = button.getAttribute('aria-controls');
  if (id === null) throw new Error('rail button controls nothing');
  const drawer = document.getElementById(id);
  if (drawer === null) throw new Error(`no element #${id}`);
  return drawer;
}

async function openDrawer() {
  const button = await railButton();
  fireEvent.click(button);
  return { button, drawer: drawerOf(button) };
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '?view=tab');
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('narrow and side by side (O2)', () => {
  test('the third column is the rail: one button, and no pane', async () => {
    installMatchMedia(true);
    await renderHome(false);

    const button = await railButton();

    expect(openNowSlot().contains(button)).toBe(true);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(within(openNowSlot()).getAllByRole('button')).toEqual([button]);
    expect(screen.queryByText(PANE_ONLY)).not.toBeInTheDocument();
    // PREMISE: side by side, so the saved detail is still on screen.
    expect(screen.getByRole('button', { name: HERO_ONLY })).toBeInTheDocument();
  });

  test('clicking the rail opens the drawer with the pane, and focus moves to its heading', async () => {
    installMatchMedia(true);
    await renderHome(false);

    const { button, drawer } = await openDrawer();

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer).getByText(PANE_ONLY)).toBeInTheDocument();
    expect(within(drawer).getByText('B')).toBeInTheDocument();
    const heading = within(drawer).getByRole('heading', { name: 'Open now' });
    expect(document.activeElement).toBe(heading);
    expect(
      within(drawer).getByRole('button', { name: CLOSE })
    ).toBeInTheDocument();
    expect(
      within(drawer).getByRole('button', {
        name: 'Fold the saved session away',
      })
    ).toBeInTheDocument();
  });

  test('Esc closes the drawer and returns focus to the rail button', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button, drawer } = await openDrawer();
    // PREMISE: focus is inside the drawer, where the key is pressed.
    expect(drawer.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement ?? drawer, { key: 'Escape' });

    expect(drawer).not.toBeInTheDocument();
    expect(screen.queryByText(PANE_ONLY)).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(button);
  });

  test('Close Open now closes the drawer and returns focus to the rail button', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button, drawer } = await openDrawer();

    fireEvent.click(within(drawer).getByRole('button', { name: CLOSE }));

    expect(drawer).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(button);
  });

  test('growing past 1100px removes the rail and the drawer, and the column pane is back', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { drawer } = await openDrawer();

    act(() => railQuery.setMatches(false));

    expect(drawer).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: RAIL_NAME })
    ).not.toBeInTheDocument();
    expect(within(openNowSlot()).getByText(PANE_ONLY)).toBeInTheDocument();
    expect(
      within(openNowSlot()).queryByRole('button', { name: CLOSE })
    ).not.toBeInTheDocument();
  });

  // A count of 0 while Chrome has not answered would be false, so the name
  // waits for the first read.
  test('while the first read is in flight, the rail button is named Open now, with no count', async () => {
    installMatchMedia(true);
    await renderWithProviders(<MainContainer />, {
      seed: twoWindows(),
      seedStore: (store) => {
        store.dispatch(setFoldSavedSessionInTabView(false));
        // After the fake is installed and before the pane mounts: the read
        // never settles.
        vi.spyOn(chrome.windows, 'getAll').mockImplementation(
          () => new Promise(() => {})
        );
      },
    });

    const button = await screen.findByRole('button', { name: 'Open now' });
    // Settle everything that can settle: the name must still have no count.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(button).toHaveAccessibleName('Open now');
    expect(openNowSlot().contains(button)).toBe(true);
  });

  // The other way: a window narrowed to under 1100px swaps the column for
  // the rail, closed.
  test('narrowing below 1100px swaps the column pane for the closed rail', async () => {
    installMatchMedia(false);
    await renderHome(false);
    await within(openNowSlot()).findByText('B');

    act(() => railQuery.setMatches(true));

    const button = await railButton();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(PANE_ONLY)).not.toBeInTheDocument();
  });

  // Folding from the drawer puts Open now in the detail column, where there
  // is no rail to hang a drawer from.
  test('Fold the saved session away from the drawer folds, and the rail is gone', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { drawer } = await openDrawer();

    fireEvent.click(
      within(drawer).getByRole('button', {
        name: 'Fold the saved session away',
      })
    );

    expect(drawer).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: RAIL_NAME })
    ).not.toBeInTheDocument();
    expect(within(openNowSlot()).getByText(PANE_ONLY)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: HERO_ONLY })
    ).not.toBeInTheDocument();
  });
});

describe('the rail is only for side by side (O2)', () => {
  test('narrow and folded: no rail, and the pane is in the detail area', async () => {
    installMatchMedia(true);
    await renderHome(true);

    await within(openNowSlot()).findByText('B');

    expect(within(openNowSlot()).getByText(PANE_ONLY)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: RAIL_NAME })
    ).not.toBeInTheDocument();
    // Folded, the saved detail is not rendered and Open now holds its area.
    expect(document.querySelector('[data-pane="detail"]')).toBeNull();
  });

  // CONTROL. Wide and side by side is the Task 5 column, with no rail: the
  // setup that makes the narrow tests' absence of a pane mean something.
  test('CONTROL: wide and side by side shows the column pane and no rail', async () => {
    installMatchMedia(false);
    await renderHome(false);

    await within(openNowSlot()).findByText('B');

    expect(within(openNowSlot()).getByText(PANE_ONLY)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: RAIL_NAME })
    ).not.toBeInTheDocument();
  });
});

// jsdom evaluates no media query, so this reads the rule the grid emits. It
// pins that the 44px track and the rail answer the one query: were the two
// written apart, one could be edited without the other.
describe('the grid and the rail share one query (O2)', () => {
  test("the grid's 44px third track sits under the rail's query", async () => {
    installMatchMedia(true);
    await renderHome(false);
    await railButton();

    const css = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');
    const railRule = new RegExp(
      `@media ${OPEN_NOW_RAIL_QUERY.replace(
        /[()]/g,
        '\\$&'
      )}\\s*\\{[^}]*grid-template-columns:\\s*356px minmax\\(0, 1fr\\) 44px`
    );
    expect(css).toMatch(railRule);
  });
});

// A fold or unfold that swaps the rail for the pane (or back) unmounts the
// button that was pressed. Focus goes to what took its place, not to <body>.
// Where nothing is swapped (wide), the pressed button stays, and so does focus.
describe('focus after a fold or unfold (O2)', () => {
  const FOLD = 'Fold the saved session away';
  const UNFOLD = 'Show the saved session';

  // A keyboard press: the control has focus, then activates.
  const press = (el: HTMLElement) => {
    el.focus();
    fireEvent.click(el);
  };

  test('Fold the saved session away from the drawer moves focus to the Open now heading in the detail area', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { drawer } = await openDrawer();

    press(within(drawer).getByRole('button', { name: FOLD }));

    // PREMISE: folded, so the slot holds the detail area and the saved
    // detail is gone.
    expect(document.querySelector('[data-pane="detail"]')).toBeNull();
    expect(getComputedStyle(openNowSlot()).getPropertyValue('grid-area')).toBe(
      'detail'
    );
    const heading = within(openNowSlot()).getByRole('heading', {
      name: 'Open now',
    });
    expect(document.activeElement).toBe(heading);
  });

  test('Show the saved session while narrow moves focus to the rail button', async () => {
    installMatchMedia(true);
    await renderHome(true);
    await within(openNowSlot()).findByText('B');

    press(within(openNowSlot()).getByRole('button', { name: UNFOLD }));

    const button = await railButton();
    expect(document.activeElement).toBe(button);
  });

  // Only a press that swaps may move focus. A wide press swaps nothing, so it
  // must leave nothing pending for a later resize to act on.
  test('a window narrowed after a wide fold and unfold does not pull focus to the rail', async () => {
    installMatchMedia(false);
    await renderHome(false);
    await within(openNowSlot()).findByText('B');
    press(within(openNowSlot()).getByRole('button', { name: FOLD }));
    press(within(openNowSlot()).getByRole('button', { name: UNFOLD }));

    act(() => railQuery.setMatches(true));

    const button = await railButton();
    expect(document.activeElement).not.toBe(button);
  });

  // CONTROL. Wide, the pane is not swapped: the pressed button is the same
  // element, relabelled, and keeps focus as it did before the rail existed.
  test('CONTROL: wide, fold and unfold keep focus on the fold button', async () => {
    installMatchMedia(false);
    await renderHome(false);
    await within(openNowSlot()).findByText('B');

    press(within(openNowSlot()).getByRole('button', { name: FOLD }));
    expect(document.activeElement).toBe(
      within(openNowSlot()).getByRole('button', { name: UNFOLD })
    );

    press(within(openNowSlot()).getByRole('button', { name: UNFOLD }));
    expect(document.activeElement).toBe(
      within(openNowSlot()).getByRole('button', { name: FOLD })
    );
  });
});

// The heading wraps the label that used to stand alone. An h2 brings its own
// margin and bold; neither may reach the label (scaleConformance: the popup
// declares no font weight, so the label's weight is whatever it inherits).
describe('the Open now heading looks as the label did', () => {
  test('the h2 has no margin, and the label inside keeps its size and its inherited weight', async () => {
    await renderWithProviders(<OpenNowPane windows={[]} actions={[]} />);

    const heading = screen.getByRole('heading', { name: 'Open now' });
    const label = heading.firstElementChild;
    const header = heading.parentElement;
    if (!(label instanceof HTMLElement) || header === null) {
      throw new Error('heading has no label, or no parent');
    }

    expect(getComputedStyle(heading).marginTop).toBe('0px');
    expect(getComputedStyle(heading).marginBottom).toBe('0px');
    // jsdom resolves rem against a 16px root (measured: 1.1rem is 17.6px).
    expect(getComputedStyle(label).fontSize).toBe(
      `${parseFloat(TYPE.SECTION) * 16}px`
    );
    // jsdom's own sheet makes an h2 bold (measured: 'bold'); the label must
    // read the weight its header does, as it did outside the h2.
    expect(getComputedStyle(heading).fontWeight).toBe(
      getComputedStyle(header).fontWeight
    );
    expect(getComputedStyle(label).fontWeight).not.toBe('bold');
  });
});
