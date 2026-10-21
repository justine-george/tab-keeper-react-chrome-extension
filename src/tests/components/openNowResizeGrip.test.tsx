import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import de from '../../../public/locales/de/translation.json';
import MainContainer from '../../components/MainContainer';
import { OPEN_NOW_RAIL_QUERY } from '../../components/home/opennow/railQuery';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { classRulesFor } from '../setup/hoverRules';
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
import { rgb } from '../setup/hexColor';

// KAN-321 O1a. The grip on the line between the saved session and Open now:
// a focusable role="separator" that a pointer drag and the arrow keys resize,
// and a double-click resets. At 1600px wide the default is 600px and the
// limits are 480..720 beside the list's default 400; at 1440, 540 and
// 480..600; at 1316px and narrower the range is empty and there is no grip
// (paneWidths.ts).
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
    expect(separator).toHaveAttribute('aria-valuenow', '600');
    expect(separator).toHaveAttribute('aria-valuemin', '480');
    expect(separator).toHaveAttribute('aria-valuemax', '720');
    expect(separator).toHaveAttribute('tabindex', '0');
    expect(separator).toHaveAttribute('data-resize-grip');
    // A grid child of its own, beside the panes: inside none of them, so no
    // row drag can start from it.
    expect(separator.closest('[data-pane]')).toBeNull();
  });
});

function pane(name: 'detail' | 'open-now'): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-pane="${name}"]`);
  if (el === null) throw new Error(`no ${name} pane`);
  return el;
}

describe('the grip comes and goes in place (O1a)', () => {
  // The grip comes and goes (the rail, a fold); Open now must not remount
  // when it does, or its scroll, focus and live-window state are lost.
  test('Open now is not remounted when the grip goes and comes back', async () => {
    const railQuery = new FakeMediaQueryList(OPEN_NOW_RAIL_QUERY, false);
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
      query === OPEN_NOW_RAIL_QUERY
        ? railQuery
        : new FakeMediaQueryList(query, false)
    );
    const { store } = await renderHome();
    await mounted();
    const openNow = pane('open-now');

    act(() => railQuery.setMatches(true));
    // PREMISE: the grip went.
    expect(
      screen.queryByRole('separator', { name: NAME })
    ).not.toBeInTheDocument();
    expect(pane('open-now')).toBe(openNow);
    act(() => railQuery.setMatches(false));
    expect(grip()).toBeInTheDocument();
    expect(pane('open-now')).toBe(openNow);

    act(() => {
      store.dispatch(setFoldSavedSessionInTabView(true));
    });
    expect(
      screen.queryByRole('separator', { name: NAME })
    ).not.toBeInTheDocument();
    expect(pane('open-now')).toBe(openNow);
    act(() => {
      store.dispatch(setFoldSavedSessionInTabView(false));
    });
    expect(grip()).toBeInTheDocument();
    expect(pane('open-now')).toBe(openNow);

    // A window too narrow for both panes' 480px (O1a).
    setViewportWidth(1280);
    expect(
      screen.queryByRole('separator', { name: NAME })
    ).not.toBeInTheDocument();
    expect(pane('open-now')).toBe(openNow);
    setViewportWidth(1600);
    expect(grip()).toBeInTheDocument();
    expect(pane('open-now')).toBe(openNow);
  });
});

describe('only side by side (O1a)', () => {
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

    expect(
      screen.queryByRole('separator', { name: NAME })
    ).not.toBeInTheDocument();
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
    // PREMISE: Settings replaced Open now.
    expect(document.querySelector('[data-pane="open-now"]')).toBeNull();

    act(() => {
      store.dispatch(closeSettingsPage());
    });

    expect(grip()).toHaveAttribute('aria-valuenow', '700');
    expect(openNowTrack()).toBe('700px');
  });

  test('not in the popup', async () => {
    history.replaceState(null, '', '/');
    await renderHome();
    await mounted();

    expect(
      screen.queryByRole('separator', { name: NAME })
    ).not.toBeInTheDocument();
    expect(document.querySelector('[data-resize-grip]')).toBeNull();
  });
});

describe('the arrow keys (O1a)', () => {
  test('ArrowLeft makes Open now 16px wider, ArrowRight 16px narrower, each saved', async () => {
    await renderHome();
    await mounted();

    // fireEvent returns false when the handler called preventDefault().
    expect(fireEvent.keyDown(grip(), { key: 'ArrowLeft' })).toBe(false);
    expect(storedWidth()).toBe(616);
    expect(grip()).toHaveAttribute('aria-valuenow', '616');
    expect(openNowTrack()).toBe('616px');

    expect(fireEvent.keyDown(grip(), { key: 'ArrowRight' })).toBe(false);
    expect(storedWidth()).toBe(600);
    expect(grip()).toHaveAttribute('aria-valuenow', '600');
  });

  // Beside the list's 400 the max is 720 (KAN-687: it reads the list).
  test('ArrowLeft stops at the max, 720', async () => {
    await renderHome({ width: 710 });
    await mounted();

    fireEvent.keyDown(grip(), { key: 'ArrowLeft' });
    expect(storedWidth()).toBe(720);
    fireEvent.keyDown(grip(), { key: 'ArrowLeft' });

    expect(storedWidth()).toBe(720);
    expect(grip()).toHaveAttribute('aria-valuenow', '720');
  });

  // O1a: "the stored width is kept". At 1440 a stored 764 shows as the max,
  // 604; ← there cannot widen anything, so it must not save 604 over 764.
  test('ArrowLeft at a clamped max saves nothing, and widening brings the stored width back', async () => {
    const { seen } = await renderHome({ width: 764 });
    await mounted();
    setViewportWidth(1440);
    // PREMISE: the stored width is clamped to 1440's max.
    expect(grip()).toHaveAttribute('aria-valuenow', '604');
    const writesBefore = widthWrites(seen);

    // Still taken: the page must not scroll under the grip.
    expect(fireEvent.keyDown(grip(), { key: 'ArrowLeft' })).toBe(false);

    expect(widthWrites(seen)).toBe(writesBefore);
    expect(storedWidth()).toBe(764);
    setViewportWidth(1600);
    expect(grip()).toHaveAttribute('aria-valuenow', '764');
    expect(openNowTrack()).toBe('764px');
  });

  // The mirror at the min. Wherever there is a grip (above 1316px) the min
  // is 480, so the only stored width it can hide is one under 480: one saved
  // while the min was 300, or a hand-edited value (asPaneWidth keeps any
  // positive number).
  test('ArrowRight at a clamped min saves nothing', async () => {
    const { seen } = await renderHome({ width: 300 });
    await mounted();
    // PREMISE: the stored width is clamped up to the min.
    expect(grip()).toHaveAttribute('aria-valuenow', '480');
    const writesBefore = widthWrites(seen);

    expect(fireEvent.keyDown(grip(), { key: 'ArrowRight' })).toBe(false);

    expect(widthWrites(seen)).toBe(writesBefore);
    expect(storedWidth()).toBe(300);
  });
});

describe('the pointer drag (O1a, Review Focus 4)', () => {
  // The window narrows under a drag: the limits follow it at once, not at
  // the next pointermove.
  test('a window narrowed mid-drag clamps the live width before the next move', async () => {
    await renderHome();
    await mounted();

    press(1000);
    moveTo(900);
    // PREMISE: the drag shows a width above 1440's max, 604.
    expect(openNowTrack()).toBe('700px');

    setViewportWidth(1440);

    expect(openNowTrack()).toBe('604px');
    expect(grip()).toHaveAttribute('aria-valuenow', '604');
    release(900);
  });

  // Narrowed past 1316px mid-drag, the range is gone and so is the grip.
  // Its unmount must end the drag like a cancel: nothing saved, no root
  // flag, and no live width left on the grid.
  test('a window narrowed to 1280 mid-drag ends the drag, and saves nothing', async () => {
    const { seen } = await renderHome();
    await mounted();
    const writesBefore = widthWrites(seen);

    press(1000);
    moveTo(900);
    expect(openNowTrack()).toBe('700px');
    expect(isResizing()).toBe(true);

    setViewportWidth(1280);

    // PREMISE: the grip is gone mid-drag.
    expect(
      screen.queryByRole('separator', { name: NAME })
    ).not.toBeInTheDocument();
    expect(isResizing()).toBe(false);
    expect(openNowTrack()).toBe('444px');
    // The drag is over: a later move and release do nothing.
    moveTo(800);
    release(800);
    expect(widthWrites(seen)).toBe(writesBefore);
    expect(storedWidth()).toBeNull();

    // Widened again, no live width was left behind: the default, not 700.
    setViewportWidth(1600);
    expect(openNowTrack()).toBe('600px');
    expect(grip()).toHaveAttribute('aria-valuenow', '600');
    expect(grip()).not.toHaveAttribute('data-active');
  });

  test('the Esc that ends a resize is prevented; one with no resize is not (KAN-403)', async () => {
    await renderHome();
    await mounted();
    const escape = () =>
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
    const idle = escape();
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    press(1000);
    moveTo(900);
    const live = escape();
    act(() => {
      window.dispatchEvent(live);
    });

    expect(isResizing()).toBe(false);
    expect(live.defaultPrevented).toBe(true);
  });

  test('Escape mid-drag puts the width back and saves nothing', async () => {
    const { seen } = await renderHome();
    await mounted();
    const writesBefore = widthWrites(seen);

    press(1000);
    moveTo(900);
    // PREMISE: the drag is showing.
    expect(openNowTrack()).toBe('700px');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(openNowTrack()).toBe('600px');
    expect(storedWidth()).toBeNull();
    expect(widthWrites(seen)).toBe(writesBefore);
    expect(isResizing()).toBe(false);
    // The drag is over: a later move and release do nothing.
    moveTo(800);
    release(800);
    expect(openNowTrack()).toBe('600px');
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
    expect(openNowTrack()).toBe('600px');
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
    expect(openNowTrack()).toBe('600px');
  });

  test('only the main button starts a drag', async () => {
    await renderHome();
    await mounted();

    fireEvent.pointerDown(grip(), { clientX: 1000, clientY: 300, button: 2 });
    moveTo(900);

    expect(isResizing()).toBe(false);
    expect(openNowTrack()).toBe('600px');
  });
});

describe('the double-click (O1a, Review Focus 5)', () => {
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
    expect(openNowTrack()).toBe('600px');
    expect(grip()).toHaveAttribute('aria-valuenow', '600');
  });
});

// jsdom applies no :hover or :focus-visible, so what can be said here is the
// rules Emotion injected (hoverRules.ts); the painted colours are Task 5's.
// Light is the store's default theme.

// The declarations of every injected rule whose selector list includes
// exactly `selector`, joined, or null when no rule has it. Every rule: one
// state's declarations can be split over several (the focus ring is a rule
// of its own, beside the one it shares with hover).
function declarationsFor(el: Element, selector: string): string | null {
  const found: string[] = [];
  for (const rule of classRulesFor(el).split('\n')) {
    const open = rule.indexOf('{');
    const selectors = rule
      .slice(0, open)
      .split(',')
      .map((part) => part.trim());
    if (selectors.includes(selector)) found.push(rule.slice(open));
  }
  return found.length === 0 ? null : found.join('\n');
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

  // O1a: "on hover, keyboard focus and during the drag, TEXT_COLOR on a
  // HOVER_COLOR chip, plus the app's focus ring on keyboard focus". Only
  // while navigating by keyboard (KAN-689).
  test("keyboard-focused, it has the hover colours and the app's focus ring", async () => {
    await renderHome();
    await mounted();
    const cls = `html[data-key-nav] ${gripClass(grip())}`;

    expect(declarationsFor(grip(), `${cls}:focus-visible>span`)).toContain(
      `background-color: ${rgb(LIGHT_THEME.HOVER_COLOR)}`
    );
    expect(declarationsFor(grip(), `${cls}:focus-visible>span>span`)).toContain(
      `background-color: ${rgb(LIGHT_THEME.TEXT_COLOR)}`
    );
    // The app's ring (dialogButtons.ts): 2px of TEXT_COLOR, on the chip.
    // jsdom keeps an outline shorthand's colour as written (hex), unlike a
    // background-color, which it serialises as rgb().
    expect(
      declarationsFor(grip(), `${cls}:focus-visible>span`)?.toLowerCase()
    ).toContain(`outline: 2px solid ${LIGHT_THEME.TEXT_COLOR.toLowerCase()}`);
  });

  test('during its drag ([data-active]) it has the hover colours', async () => {
    await renderHome();
    await mounted();
    const cls = gripClass(grip());

    expect(declarationsFor(grip(), `${cls}[data-active]>span`)).toContain(
      `background-color: ${rgb(LIGHT_THEME.HOVER_COLOR)}`
    );
    expect(declarationsFor(grip(), `${cls}[data-active]>span>span`)).toContain(
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
        name: 'Breite des Bereichs „Offene Tabs“ ändern',
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
