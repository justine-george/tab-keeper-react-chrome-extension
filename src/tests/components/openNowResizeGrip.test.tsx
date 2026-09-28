import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import de from '../../../public/locales/de/translation.json';
import MainContainer from '../../components/MainContainer';
import { OPEN_NOW_RAIL_QUERY } from '../../components/home/opennow/railQuery';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { hoverRulesFor } from '../setup/hoverRules';
import { openNowTrack } from '../setup/openNowTrack';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setFoldSavedSessionInTabView,
  setOpenNowWidth,
} from '../../redux/slices/settingsDataStateSlice';
import {
  closeSettingsPage,
  openSettingsPage,
} from '../../redux/slices/globalStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-321 O1a. The grip on the line between the saved session and Open now:
// a focusable role="separator" that a pointer drag and the arrow keys resize,
// and a double-click resets. At 1600px wide the default is 622px and the
// limits are 300..764 (openNowWidth.ts).
//
// jsdom has no layout and no pointer capture. The drag is driven the way the
// grip reads it: a press on the grip, then moves and the release on `window`.
// What the drag LOOKS like (the cursor, the chip, the 12px hit area on the
// line) is Task 5's real-browser spec.

const NAME = 'Resize Open now';
const SET_WIDTH = setOpenNowWidth.type;

const ORIGINAL_INNER_WIDTH = window.innerWidth;

const setViewportWidth = (width: number) => {
  act(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: width,
    });
    window.dispatchEvent(new Event('resize'));
  });
};

const goToTabView = () => history.replaceState(null, '', '?view=tab');

type Setup = {
  fold?: boolean;
  width?: number;
};

// One saved session, selected; side by side unless `fold`; `width` stored
// before the first render when given.
const renderHome = ({ fold = false, width }: Setup = {}) =>
  renderWithProviders(<MainContainer />, {
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: 'first', title: 'First session' })
        )
      );
      store.dispatch(selectTabContainer('first'));
      store.dispatch(setFoldSavedSessionInTabView(fold));
      if (width !== undefined) store.dispatch(setOpenNowWidth(width));
    },
  });

// Waits for the app to mount before any negative query is trusted.
const mounted = () => screen.findByRole('button', { name: 'Sort sessions' });

const grip = () => screen.getByRole('separator', { name: NAME });

// The width as saved on this device: a number, or null for "the default"
// (stored as null, or never stored at all).
function storedWidth(): number | null {
  const raw = localStorage.getItem('settingsData');
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'openNowWidth' in parsed &&
    typeof parsed.openNowWidth === 'number'
  ) {
    return parsed.openNowWidth;
  }
  return null;
}

const widthWrites = (seen: string[]) =>
  seen.filter((type) => type === SET_WIDTH).length;

const isResizing = () => document.documentElement.hasAttribute('data-resizing');

const press = (x: number) =>
  fireEvent.pointerDown(grip(), { clientX: x, clientY: 300, button: 0 });
const moveTo = (x: number) =>
  fireEvent.pointerMove(window, { clientX: x, clientY: 300 });
const release = (x: number) =>
  fireEvent.pointerUp(window, { clientX: x, clientY: 300 });

beforeEach(() => {
  localStorage.clear();
  setViewportWidth(1600);
  goToTabView();
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: ORIGINAL_INNER_WIDTH,
  });
  // A failing test must not leave the flags for the next one.
  document.documentElement.removeAttribute('data-resizing');
  document.documentElement.removeAttribute('data-dragging');
});

describe('the grip is a separator (O1a)', () => {
  test('named "Resize Open now", vertical, with the shown width and its limits', async () => {
    await renderHome();
    await mounted();

    const separator = grip();
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('aria-valuenow', '622');
    expect(separator).toHaveAttribute('aria-valuemin', '300');
    expect(separator).toHaveAttribute('aria-valuemax', '764');
    expect(separator).toHaveAttribute('tabindex', '0');
    expect(separator).toHaveAttribute('data-resize-grip');
    // A grid child of its own, beside the panes: inside none of them, so no
    // row drag can start from it.
    expect(separator.closest('[data-pane]')).toBeNull();
  });
});

describe('only side by side (O1a)', () => {
  // CONTROL for the absences below: the same page side by side has it.
  test('CONTROL: side by side and wide, it is there', async () => {
    await renderHome();
    await mounted();

    expect(screen.getByRole('separator', { name: NAME })).toBeInTheDocument();
  });

  test('not when folded', async () => {
    await renderHome({ fold: true });
    await mounted();
    // PREMISE: Open now is on screen, in the detail column.
    expect(document.querySelector('[data-pane="open-now"]')).not.toBeNull();

    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(document.querySelector('[data-resize-grip]')).toBeNull();
  });

  test('not below 1100px, where Open now is the rail', async () => {
    const railQuery = new FakeMediaQueryList(OPEN_NOW_RAIL_QUERY, true);
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
      query === OPEN_NOW_RAIL_QUERY
        ? railQuery
        : new FakeMediaQueryList(query, false)
    );
    await renderHome();
    await mounted();
    // PREMISE: the rail is what shows.
    expect(
      await screen.findByRole('button', { name: /^Open now, / })
    ).toBeInTheDocument();

    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(document.querySelector('[data-resize-grip]')).toBeNull();
  });

  test('not on the Settings page', async () => {
    const { store } = await renderHome();
    await mounted();
    // PREMISE: it was there before Settings opened.
    expect(grip()).toBeInTheDocument();

    await act(async () => {
      await store.dispatch(openSettingsPage(undefined));
    });

    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(document.querySelector('[data-resize-grip]')).toBeNull();
  });

  // React reuses the grid element for Settings' own grid (same type, same
  // slot), and the width is a property set on that element. So the property
  // outlives Settings; these two check it is RIGHT when Settings closes.
  test('back from Settings, the grip and the width are back', async () => {
    const { store } = await renderHome({ width: 700 });
    await mounted();
    await act(async () => {
      await store.dispatch(openSettingsPage(undefined));
    });
    // PREMISE: Settings replaced the grid.
    expect(document.querySelector('[data-pane="open-now"]')).toBeNull();

    act(() => {
      store.dispatch(closeSettingsPage());
    });

    expect(grip()).toHaveAttribute('aria-valuenow', '700');
    expect(openNowTrack()).toBe('700px');
  });

  // The width did not change above, so a property left over from before
  // Settings reads right. Here the window narrows while Settings is open.
  test("back from Settings after the window narrowed, the width is the new window's", async () => {
    const { store } = await renderHome();
    await mounted();
    expect(openNowTrack()).toBe('622px');
    const gridBefore = document.querySelector('[data-pane="open-now"]')
      ?.parentElement;
    await act(async () => {
      await store.dispatch(openSettingsPage(undefined));
    });

    setViewportWidth(1280);
    act(() => {
      store.dispatch(closeSettingsPage());
    });

    // PREMISE: the same grid element came back, with the old property on it.
    expect(
      document.querySelector('[data-pane="open-now"]')?.parentElement
    ).toBe(gridBefore);
    expect(grip()).toHaveAttribute('aria-valuenow', '444');
    expect(openNowTrack()).toBe('444px');
  });

  test('not in the popup', async () => {
    history.replaceState(null, '', '/');
    await renderHome();
    await mounted();

    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(document.querySelector('[data-resize-grip]')).toBeNull();
  });
});

describe('the arrow keys (O1a)', () => {
  test('ArrowLeft makes Open now 16px wider, ArrowRight 16px narrower, each saved', async () => {
    await renderHome();
    await mounted();

    // fireEvent returns false when the handler called preventDefault().
    expect(fireEvent.keyDown(grip(), { key: 'ArrowLeft' })).toBe(false);
    expect(storedWidth()).toBe(638);
    expect(grip()).toHaveAttribute('aria-valuenow', '638');
    expect(openNowTrack()).toBe('638px');

    expect(fireEvent.keyDown(grip(), { key: 'ArrowRight' })).toBe(false);
    expect(storedWidth()).toBe(622);
    expect(grip()).toHaveAttribute('aria-valuenow', '622');
  });

  test('ArrowLeft stops at the max, 764', async () => {
    await renderHome({ width: 760 });
    await mounted();

    fireEvent.keyDown(grip(), { key: 'ArrowLeft' });
    expect(storedWidth()).toBe(764);
    fireEvent.keyDown(grip(), { key: 'ArrowLeft' });

    expect(storedWidth()).toBe(764);
    expect(grip()).toHaveAttribute('aria-valuenow', '764');
  });

  test('ArrowRight stops at the min, 300', async () => {
    await renderHome({ width: 310 });
    await mounted();

    fireEvent.keyDown(grip(), { key: 'ArrowRight' });

    expect(storedWidth()).toBe(300);
    expect(grip()).toHaveAttribute('aria-valuenow', '300');
  });

  // O1a: "the stored width is kept". At 1280 a stored 764 shows as the max,
  // 444; ← there cannot widen anything, so it must not save 444 over 764.
  test('ArrowLeft at a clamped max saves nothing, and widening brings the stored width back', async () => {
    const { seen } = await renderHome({ width: 764 });
    await mounted();
    setViewportWidth(1280);
    // PREMISE: the stored width is clamped to 1280's max.
    expect(grip()).toHaveAttribute('aria-valuenow', '444');
    const writesBefore = widthWrites(seen);

    // Still taken: the page must not scroll under the grip.
    expect(fireEvent.keyDown(grip(), { key: 'ArrowLeft' })).toBe(false);

    expect(widthWrites(seen)).toBe(writesBefore);
    expect(storedWidth()).toBe(764);
    setViewportWidth(1600);
    expect(grip()).toHaveAttribute('aria-valuenow', '764');
    expect(openNowTrack()).toBe('764px');
  });

  // The mirror at the min. The min does not move with the window, so the
  // only stored width it can hide is one under 300 (a hand-edited value;
  // asOpenNowWidth keeps any positive number).
  test('ArrowRight at a clamped min saves nothing', async () => {
    const { seen } = await renderHome({ width: 250 });
    await mounted();
    // PREMISE: the stored width is clamped up to the min.
    expect(grip()).toHaveAttribute('aria-valuenow', '300');
    const writesBefore = widthWrites(seen);

    expect(fireEvent.keyDown(grip(), { key: 'ArrowRight' })).toBe(false);

    expect(widthWrites(seen)).toBe(writesBefore);
    expect(storedWidth()).toBe(250);
  });
});

describe('the pointer drag (O1a, Review Focus 4)', () => {
  test('dragging left widens Open now live, and saves once, on release', async () => {
    const { seen } = await renderHome();
    await mounted();
    const writesBefore = widthWrites(seen);

    press(1000);
    moveTo(950);
    moveTo(900);

    expect(openNowTrack()).toBe('722px');
    expect(grip()).toHaveAttribute('aria-valuenow', '722');
    expect(storedWidth()).toBeNull();
    expect(widthWrites(seen)).toBe(writesBefore);

    release(900);

    expect(storedWidth()).toBe(722);
    expect(widthWrites(seen)).toBe(writesBefore + 1);
    expect(openNowTrack()).toBe('722px');
  });

  test('the drag clamps to the limits', async () => {
    await renderHome();
    await mounted();

    press(1000);
    moveTo(0);
    expect(openNowTrack()).toBe('764px');
    moveTo(1590);
    expect(openNowTrack()).toBe('300px');
    release(1590);

    expect(storedWidth()).toBe(300);
  });

  // The window narrows under a drag: the limits follow it at once, not at
  // the next pointermove.
  test('a window narrowed mid-drag clamps the live width before the next move', async () => {
    await renderHome();
    await mounted();

    press(1000);
    moveTo(900);
    // PREMISE: the drag shows a width above 1280's max, 444.
    expect(openNowTrack()).toBe('722px');

    setViewportWidth(1280);

    expect(openNowTrack()).toBe('444px');
    expect(grip()).toHaveAttribute('aria-valuenow', '444');
    release(900);
  });

  test('Escape mid-drag puts the width back and saves nothing', async () => {
    const { seen } = await renderHome();
    await mounted();
    const writesBefore = widthWrites(seen);

    press(1000);
    moveTo(900);
    // PREMISE: the drag is showing.
    expect(openNowTrack()).toBe('722px');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(openNowTrack()).toBe('622px');
    expect(storedWidth()).toBeNull();
    expect(widthWrites(seen)).toBe(writesBefore);
    expect(isResizing()).toBe(false);
    // The drag is over: a later move and release do nothing.
    moveTo(800);
    release(800);
    expect(openNowTrack()).toBe('622px');
    expect(storedWidth()).toBeNull();
  });

  test('pointercancel mid-drag ends it and saves nothing', async () => {
    const { seen } = await renderHome();
    await mounted();
    const writesBefore = widthWrites(seen);

    press(1000);
    moveTo(900);
    expect(isResizing()).toBe(true);

    fireEvent.pointerCancel(window);

    expect(storedWidth()).toBeNull();
    expect(widthWrites(seen)).toBe(writesBefore);
    expect(isResizing()).toBe(false);
    expect(openNowTrack()).toBe('622px');
  });

  test('the window losing focus mid-drag ends it and saves nothing', async () => {
    const { seen } = await renderHome();
    await mounted();
    const writesBefore = widthWrites(seen);

    press(1000);
    moveTo(900);
    expect(isResizing()).toBe(true);

    fireEvent.blur(window);

    expect(widthWrites(seen)).toBe(writesBefore);
    expect(isResizing()).toBe(false);
    expect(openNowTrack()).toBe('622px');
  });

  test('a drag cut short by an unmount leaves no flag and no listener', async () => {
    const { seen, unmount } = await renderHome();
    await mounted();
    const writesBefore = widthWrites(seen);

    press(1000);
    moveTo(900);
    expect(isResizing()).toBe(true);

    unmount();

    expect(isResizing()).toBe(false);
    release(900);
    expect(widthWrites(seen)).toBe(writesBefore);
  });

  // The grip goes while the page stays: the window narrows to the rail
  // mid-drag. The grid must not keep the width nobody is dragging any more.
  test('a drag cut short by the rail taking over leaves no live width behind', async () => {
    const railQuery = new FakeMediaQueryList(OPEN_NOW_RAIL_QUERY, false);
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
      query === OPEN_NOW_RAIL_QUERY
        ? railQuery
        : new FakeMediaQueryList(query, false)
    );
    const { seen } = await renderHome();
    await mounted();
    const writesBefore = widthWrites(seen);

    press(1000);
    moveTo(900);
    expect(openNowTrack()).toBe('722px');

    act(() => railQuery.setMatches(true));
    // PREMISE: the grip is gone mid-drag.
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(isResizing()).toBe(false);
    act(() => railQuery.setMatches(false));

    expect(openNowTrack()).toBe('622px');
    expect(grip()).toHaveAttribute('aria-valuenow', '622');
    release(900);
    expect(widthWrites(seen)).toBe(writesBefore);
  });

  test('data-resizing is on the root during the drag and gone after the release', async () => {
    await renderHome();
    await mounted();
    expect(isResizing()).toBe(false);

    press(1000);
    expect(isResizing()).toBe(true);
    moveTo(900);
    expect(isResizing()).toBe(true);

    release(900);
    expect(isResizing()).toBe(false);
  });

  test('only the main button starts a drag', async () => {
    await renderHome();
    await mounted();

    fireEvent.pointerDown(grip(), { clientX: 1000, clientY: 300, button: 2 });
    moveTo(900);

    expect(isResizing()).toBe(false);
    expect(openNowTrack()).toBe('622px');
  });
});

describe('the double-click (O1a, Review Focus 5)', () => {
  test('a press and release without movement saves nothing', async () => {
    const { seen } = await renderHome();
    await mounted();
    const writesBefore = widthWrites(seen);

    press(1000);
    release(1000);

    expect(widthWrites(seen)).toBe(writesBefore);
    expect(storedWidth()).toBeNull();
    expect(isResizing()).toBe(false);
  });

  test('a double-click resets a saved width to null, and its presses save nothing', async () => {
    const { seen } = await renderHome({ width: 700 });
    await mounted();
    // PREMISE: the saved width shows.
    expect(storedWidth()).toBe(700);
    expect(openNowTrack()).toBe('700px');
    const writesBefore = widthWrites(seen);

    press(1000);
    release(1000);
    press(1000);
    release(1000);
    // The presses alone wrote nothing.
    expect(widthWrites(seen)).toBe(writesBefore);

    fireEvent.doubleClick(grip());

    expect(widthWrites(seen)).toBe(writesBefore + 1);
    expect(storedWidth()).toBeNull();
    expect(openNowTrack()).toBe('622px');
    expect(grip()).toHaveAttribute('aria-valuenow', '622');
  });
});

// jsdom applies no :hover or :focus-visible, so what can be said here is the
// rules Emotion injected (hoverRules.ts); the painted colours are Task 5's.
// Light is the store's default theme.
const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

// The declarations of the injected rule whose selector list includes exactly
// `selector`, or null when no rule has it.
function declarationsFor(el: Element, selector: string): string | null {
  for (const rule of hoverRulesFor(el).split('\n')) {
    const open = rule.indexOf('{');
    const selectors = rule
      .slice(0, open)
      .split(',')
      .map((part) => part.trim());
    if (selectors.includes(selector)) return rule.slice(open);
  }
  return null;
}

const gripClass = (el: Element) => {
  const cls = [...el.classList].find((c) => c.startsWith('css-'));
  if (cls === undefined) throw new Error('the grip has no emotion class');
  return `.${cls}`;
};

describe('the grip lights on hover and during its drag (O1a G A)', () => {
  test('hovered, the chip is HOVER_COLOR and the dots TEXT_COLOR', async () => {
    await renderHome();
    await mounted();
    const cls = gripClass(grip());

    expect(declarationsFor(grip(), `${cls}:hover>span`)).toContain(
      `background-color: ${rgb(LIGHT_THEME.HOVER_COLOR)}`
    );
    expect(declarationsFor(grip(), `${cls}:hover>span>span`)).toContain(
      `background-color: ${rgb(LIGHT_THEME.TEXT_COLOR)}`
    );
  });

  test('during its drag it is marked active, and not after', async () => {
    await renderHome();
    await mounted();
    expect(grip()).not.toHaveAttribute('data-active');

    press(1000);
    expect(grip()).toHaveAttribute('data-active');
    release(1000);

    expect(grip()).not.toHaveAttribute('data-active');
  });
});

describe('isolation from the row drag (O1a)', () => {
  // The rule is scoped from the ROOT: the flag is on <html>, and the grip
  // sits below it. A selector Emotion prefixes with the grip's own class
  // (".css-x:root[...] .css-x:hover") can never match, and the grip would
  // light under a row drag.
  test('a row drag passing over it keeps the rest colours', async () => {
    await renderHome();
    await mounted();
    const cls = gripClass(grip());

    expect(
      declarationsFor(grip(), `html[data-dragging] ${cls}:hover>span`)
    ).toContain(`background-color: ${rgb(LIGHT_THEME.PRIMARY_COLOR)}`);
    expect(
      declarationsFor(grip(), `html[data-dragging] ${cls}:hover>span>span`)
    ).toContain(`background-color: ${rgb(LIGHT_THEME.LABEL_L2_COLOR)}`);
  });

  // A press starting no row drag: covered by the separator test's closest('[data-pane]') check and Task 5's e2e.
});

describe('the name in another language', () => {
  test('in German the separator is named in German', async () => {
    await renderHome();
    await mounted();
    // After the render: renderWithProviders' init resets the language.
    testI18n.addResourceBundle('de', 'translation', de, true, true);
    await act(async () => {
      await testI18n.changeLanguage('de');
    });

    expect(
      screen.getByRole('separator', {
        name: 'Breite des Bereichs "Offene Tabs" ändern',
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('separator', { name: NAME })
    ).not.toBeInTheDocument();

    // The i18n instance is shared: back to English while still mounted, in
    // act, so no later test runs in German.
    await act(async () => {
      await testI18n.changeLanguage('en');
    });
  });
});
