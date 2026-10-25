import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { OPEN_NOW_RAIL_QUERY } from '../../components/home/opennow/railQuery';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import { showToast } from '../../redux/slices/globalStateSlice';
import { buildSession } from '../fixtures/sessionFixture';
import {
  currentCarry,
  endCarry,
  moveCarry,
  startCarry,
  type CarryOut,
} from '../../redux/carry';
import { liveItem } from '../../redux/carriedItem';
import { endDragHold } from '../../redux/dragHold';
import { live } from '../fixtures/liveSnapshotFixture';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { TYPE } from '../../styles/scale';
import { asWritten } from '../setup/asWritten';
import { testI18n } from '../setup/i18nForTests';
import ko from '../../../public/locales/ko/translation.json';

// KAN-280 O2. Below 1100px, side by side, Open now's column is a 44px rail
// with one button, and the button opens Open now as a drawer over the right
// side. Folded, Open now is in the detail column at any width, so no rail.

const RAIL_NAME = 'Currently open, 3 Tabs';
const CLOSE = 'Close the Currently open panel';
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

afterEach(async () => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  localStorage.clear();
  // The instance is shared, so a leaked locale would run later tests in Korean.
  await testI18n.changeLanguage('en');
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

  // KAN-776 C. The glyph alone did not say what the rail is.
  test('the rail button shows its glyph and, under it, Open now set vertically', async () => {
    installMatchMedia(true);
    await renderHome(false);

    const button = await railButton();
    const label = within(button).getByText('Currently open');
    const glyph = within(button).getByText('tab');

    expect(glyph).toHaveClass('material-symbols-outlined');
    expect(
      glyph.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(getComputedStyle(button).flexDirection).toBe('column');
    const style = getComputedStyle(label);
    expect(style.writingMode).toBe('vertical-rl');
    // jsdom resolves rem against 16px.
    expect(style.fontSize).toBe(`${parseFloat(TYPE.SECONDARY) * 16}px`);
    expect(style.color).toMatch(asWritten(LIGHT_THEME.TEXT_COLOR));
  });

  // KAN-776. Upright CJK in vertical-rl advances by the font's vertical metrics,
  // and WenQuanYi Zen Hei's are zero: every character drew on one spot. Stacked
  // in horizontal text, each takes its horizontal advance, which every font has.
  test('in Korean the label stacks each word one character per line, in horizontal text', async () => {
    installMatchMedia(true);
    await renderHome(false);
    testI18n.addResourceBundle('ko', 'translation', ko, true, true);
    await act(async () => {
      await testI18n.changeLanguage('ko');
    });

    const button = openNowSlot().querySelector('button[aria-expanded]');
    if (button === null) throw new Error('no rail button');
    const label = [...button.querySelectorAll('span')].find(
      (el) => el.textContent === ko['Open now']
    );
    if (label === undefined) throw new Error('no label');
    const words = [...label.children] as HTMLElement[];

    expect(getComputedStyle(label).writingMode).not.toBe('vertical-rl');
    expect(getComputedStyle(label).flexDirection).toBe('column');
    expect(words.map((w) => w.textContent)).toEqual(ko['Open now'].split(' '));
    for (const word of words) {
      // One em: one character wide.
      expect(getComputedStyle(word).width).toBe(
        getComputedStyle(label).fontSize
      );
    }
  });

  test('clicking the rail opens the drawer with the pane, and focus moves to its heading', async () => {
    installMatchMedia(true);
    await renderHome(false);

    const { button, drawer } = await openDrawer();

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer).getByText(PANE_ONLY)).toBeInTheDocument();
    expect(within(drawer).getByText('B')).toBeInTheDocument();
    const heading = within(drawer).getByRole('heading', {
      name: 'Currently open',
    });
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

  // An IDREF to an absent element names nothing, so the rail says what it
  // controls only while the drawer is there to point at.
  test('the rail button names the drawer in aria-controls only while it is open', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const closed = await railButton();
    expect(closed).not.toHaveAttribute('aria-controls');

    const { button, drawer } = await openDrawer();
    expect(button).toHaveAttribute('aria-controls', drawer.id);

    fireEvent.keyDown(document.activeElement ?? drawer, { key: 'Escape' });
    expect(drawer).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute('aria-controls');
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

  // KAN-784. A dialog's close sits in its top-right corner: on the heading's line, after it, not in the action row with «.
  test("Close Open now shares the heading's line, after it, and is not in the action row", async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { drawer } = await openDrawer();

    const close = within(drawer).getByRole('button', { name: CLOSE });
    const heading = within(drawer).getByRole('heading', {
      name: 'Currently open',
    });
    // The action row is Collapse all's (KAN-794 moved the fold to this line).
    const collapse = within(drawer).getByRole('button', {
      name: 'Collapse all windows',
    });
    expect(close.parentElement).toBe(heading.parentElement);
    expect(heading.compareDocumentPosition(close)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(collapse.parentElement).not.toBe(close.parentElement);
  });

  // The wide pane is not a dialog: nothing to close.
  test('the wide pane has no close button', async () => {
    installMatchMedia(false);
    await renderHome(false);
    await screen.findByText(PANE_ONLY);

    expect(screen.queryByRole('button', { name: CLOSE })).toBeNull();
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

    const button = await screen.findByRole('button', {
      name: 'Currently open',
    });
    // Settle everything that can settle: the name must still have no count.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(button).toHaveAccessibleName('Currently open');
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
      name: 'Currently open',
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

// KAN-280 Part F (N2 A). A carry out of the drawer sends it away once the pointer leaves it, so every drop works
// as wide; it comes back when the carry ends, mounted all along, its scroll kept.
describe('a carry from the drawer (N2 A)', () => {
  const LIVE = (): CarryOut => ({
    item: liveItem({
      pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
      window: live(),
      chromeWindowId: 7,
    }),
    card: { kind: 'tab', title: 'Live l1', faviconUrl: '' },
  });
  const DRAWER_BOX = DOMRect.fromRect({
    x: 644,
    y: 0,
    width: 380,
    height: 768,
  });
  const scrollerOf = (drawer: HTMLElement) => {
    const el = drawer.querySelector<HTMLElement>('[data-open-now-scroller]');
    if (el === null) throw new Error('no scroller');
    return el;
  };

  afterEach(() => {
    act(() => endCarry('cancelled'));
    endDragHold();
  });

  test('leaving the drawer sends it away; after the drop it is back, mounted all along, its scroll kept', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { drawer, button } = await openDrawer();
    drawer.getBoundingClientRect = () => DRAWER_BOX;
    const scroller = scrollerOf(drawer);
    scroller.scrollTop = 120;
    const out = LIVE();
    act(() => startCarry(out.item, out.card, 700, 100));
    expect(drawer.hasAttribute('data-carry-away')).toBe(false);
    act(() => moveCarry(300, 100));
    expect(drawer.hasAttribute('data-carry-away')).toBe(true);
    expect(drawer.inert).toBe(true);
    // Back over where it was: it stays away until the carry ends.
    act(() => moveCarry(700, 100));
    expect(drawer.hasAttribute('data-carry-away')).toBe(true);
    act(() => endCarry('committed'));
    expect(drawer.hasAttribute('data-carry-away')).toBe(false);
    expect(drawer.inert).toBe(false);
    expect(drawer.isConnected).toBe(true);
    expect(scrollerOf(drawer)).toBe(scroller);
    expect(scroller.scrollTop).toBe(120);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  test('a carry that stays inside the drawer leaves it in place', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { drawer } = await openDrawer();
    drawer.getBoundingClientRect = () => DRAWER_BOX;
    const out = LIVE();
    act(() => startCarry(out.item, out.card, 700, 100));
    act(() => moveCarry(800, 300));
    expect(drawer.hasAttribute('data-carry-away')).toBe(false);
  });

  test('a cancel brings it back too', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { drawer } = await openDrawer();
    drawer.getBoundingClientRect = () => DRAWER_BOX;
    const out = LIVE();
    act(() => startCarry(out.item, out.card, 700, 100));
    act(() => moveCarry(300, 100));
    expect(drawer.hasAttribute('data-carry-away')).toBe(true);
    act(() => endCarry('cancelled'));
    expect(drawer.hasAttribute('data-carry-away')).toBe(false);
  });

  // P8.
  test("Esc during a carry is the carry's: the carry ends and the drawer stays open", async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { drawer, button } = await openDrawer();
    const out = LIVE();
    act(() => startCarry(out.item, out.card, 700, 100));
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(currentCarry()).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  test('CONTROL: Esc with no carry still closes the drawer', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { drawer, button } = await openDrawer();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});

// KAN-681, KAN-682. The drawer is not modal: Esc closes it wherever focus is,
// and a press outside it closes it and still does what it presses.
describe('closing from outside (KAN-681, KAN-682)', () => {
  // A click on blank space moves focus to the body (the KAN-681 report).
  const focusBody = () => {
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    // PREMISE: focus is outside the drawer.
    expect(document.activeElement).toBe(document.body);
  };
  const sessionsPane = () => {
    const pane = document.querySelector<HTMLElement>('[data-pane="sessions"]');
    if (pane === null) throw new Error('no sessions pane');
    return pane;
  };
  // Chrome's own focus change for the press runs before the drawer's check.
  const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

  afterEach(() => {
    act(() => endCarry('cancelled'));
    endDragHold();
  });

  test('Esc with focus on the body closes the drawer and returns focus to the rail button', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button, drawer } = await openDrawer();
    focusBody();

    const esc = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => document.body.dispatchEvent(esc));

    expect(drawer).not.toBeInTheDocument();
    expect(document.activeElement).toBe(button);
    // Consumed, or Chrome closes the popup (KAN-403).
    expect(esc.defaultPrevented).toBe(true);
  });

  test('an Esc something else used leaves the drawer open', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button } = await openDrawer();
    focusBody();
    const claim = (e: KeyboardEvent) => e.preventDefault();
    document.body.addEventListener('keydown', claim);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    document.body.removeEventListener('keydown', claim);

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test('an Esc that ends IME composition leaves the drawer open', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button } = await openDrawer();
    focusBody();

    fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test("an Esc with a modal dialog open is the dialog's: the drawer stays", async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button } = await openDrawer();
    const modal = document.createElement('dialog');
    document.body.append(modal);
    modal.showModal();

    fireEvent.keyDown(modal, { key: 'Escape' });
    modal.remove();

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test('Esc with focus on the body during a carry leaves the drawer open', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button } = await openDrawer();
    focusBody();
    const card = { kind: 'tab', title: 'Live l1', faviconUrl: '' } as const;
    act(() =>
      startCarry(
        liveItem({
          pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
          window: live(),
          chromeWindowId: 7,
        }),
        card,
        700,
        100
      )
    );

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test('a press outside closes the drawer, and focus goes to the rail button', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button, drawer } = await openDrawer();

    fireEvent.pointerDown(sessionsPane());
    // The drawer unmounted with focus in it.
    await settle();

    expect(drawer).not.toBeInTheDocument();
    expect(document.activeElement).toBe(button);
  });

  test('a press outside still does what it presses, and keeps the focus it took', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { drawer } = await openDrawer();
    const sort = screen.getByRole('button', { name: 'Sort sessions' });

    fireEvent.pointerDown(sort);
    // Chrome's mousedown focuses the button after the drawer's pointerdown.
    act(() => sort.focus());
    fireEvent.click(sort);
    await settle();

    expect(drawer).not.toBeInTheDocument();
    expect(sort).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Sort sessions' })).toBeVisible();
    expect(document.activeElement?.closest('[role="menu"]')).not.toBeNull();
  });

  test('a press inside the drawer leaves it open', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button, drawer } = await openDrawer();

    fireEvent.pointerDown(
      within(drawer).getByRole('heading', { name: 'Currently open' })
    );
    await settle();

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test('a press on a row menu opened from the drawer leaves the drawer open', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button, drawer } = await openDrawer();
    const row = drawer.querySelector('[data-window-row]');
    if (row === null) throw new Error('no window row');
    fireEvent.contextMenu(row);
    const menu = document.querySelector<HTMLElement>('[data-row-menu]');
    if (menu === null) throw new Error('no row menu');
    // KAN-708. The menu is drawn on the body, outside the drawer.
    expect(drawer.contains(menu)).toBe(false);

    fireEvent.pointerDown(menu);
    await settle();

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test('a press on a toast leaves the drawer open', async () => {
    installMatchMedia(true);
    const { store } = await renderHome(false);
    const { button } = await openDrawer();
    await act(() => store.dispatch(showToast({ toastText: 'Session saved.' })));
    const toast = document.querySelector<HTMLElement>('[data-toast]');
    if (toast === null) throw new Error('no toast');

    fireEvent.pointerDown(toast);
    await settle();

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test('a press in a modal dialog leaves the drawer open', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button } = await openDrawer();
    const modal = document.createElement('dialog');
    document.body.append(modal);
    modal.showModal();

    fireEvent.pointerDown(modal);
    await settle();
    modal.remove();

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test('a press outside during a carry leaves the drawer open', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const { button } = await openDrawer();
    const card = { kind: 'tab', title: 'Live l1', faviconUrl: '' } as const;
    act(() =>
      startCarry(
        liveItem({
          pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
          window: live(),
          chromeWindowId: 7,
        }),
        card,
        700,
        100
      )
    );

    fireEvent.pointerDown(sessionsPane());
    await settle();

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});

// KAN-794 (his picks B and F). The fold is a panel glyph on the heading's
// line, as the drawer's close is, so the icon row keeps the actions on tabs.
describe('the fold control', () => {
  const FOLD = 'Fold the saved session away';
  const UNFOLD = 'Show the saved session';

  // The heading's line: the heading, then its controls.
  const headingLineIn = async (scope: HTMLElement) => {
    const heading = await within(scope).findByRole('heading', {
      name: 'Currently open',
    });
    const line = heading.parentElement;
    if (line === null) throw new Error('heading has no line');
    return line;
  };
  const glyphOf = (el: HTMLElement) =>
    el.querySelector('[data-icon]')?.getAttribute('data-icon');
  // The row Collapse all sits in.
  const iconRowIn = async (scope: HTMLElement) => {
    const collapse = await within(scope).findByRole('button', {
      name: 'Collapse all windows',
    });
    const row = collapse.parentElement;
    if (row === null) throw new Error('Collapse all has no row');
    return row;
  };

  test("side by side: a panel-close glyph on the heading's line, not in the icon row", async () => {
    installMatchMedia(false);
    await renderHome(false);

    const line = await headingLineIn(openNowSlot());
    const fold = within(line).getByRole('button', { name: FOLD });

    expect(glyphOf(fold)).toBe('left_panel_close');
    expect(
      within(await iconRowIn(openNowSlot())).queryByRole('button', {
        name: FOLD,
      })
    ).toBeNull();
  });

  test("folded: Show the saved session is a panel-open glyph on the heading's line", async () => {
    installMatchMedia(false);
    await renderHome(true);

    const line = await headingLineIn(openNowSlot());
    const unfold = within(line).getByRole('button', { name: UNFOLD });

    expect(glyphOf(unfold)).toBe('left_panel_open');
    expect(
      within(await iconRowIn(openNowSlot())).queryByRole('button', {
        name: UNFOLD,
      })
    ).toBeNull();
  });

  test("in the drawer the heading's line holds the fold, then the close", async () => {
    installMatchMedia(true);
    await renderHome(false);

    const { drawer } = await openDrawer();
    const line = await headingLineIn(drawer);

    expect(
      within(line)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual([FOLD, CLOSE]);
  });
});
