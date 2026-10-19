import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import de from '../../../public/locales/de/translation.json';
import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import { openNowTrack } from '../setup/openNowTrack';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setFoldSavedSessionInTabView,
  setListWidth,
  setOpenNowWidth,
} from '../../redux/slices/settingsDataStateSlice';
import {
  closeSettingsPage,
  openSettingsPage,
} from '../../redux/slices/globalStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-687. The grip on the line between the saved list and the pane beside
// it (the saved session, or folded Open now): a focusable role="separator"
// that a pointer drag and the arrow keys resize, and a double-click resets.
// At 1600px side by side the list starts at 400 (a quarter) and its range is
// 356..520, leaving the saved session 480 beside Open now's 600
// (paneWidths.ts). Dragging RIGHT widens it: its right edge is the line.
//
// jsdom has no layout: the drag is driven as the grip reads it, a press on
// the grip and then moves and the release on `window`.

const NAME = 'Resize the saved sessions list';
const SET_WIDTH = setListWidth.type;
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

type Setup = { fold?: boolean; list?: number; openNow?: number };

const renderHome = ({ fold = false, list, openNow }: Setup = {}) =>
  renderWithProviders(<MainContainer />, {
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: 'first', title: 'First session' })
        )
      );
      store.dispatch(selectTabContainer('first'));
      store.dispatch(setFoldSavedSessionInTabView(fold));
      if (list !== undefined) store.dispatch(setListWidth(list));
      if (openNow !== undefined) store.dispatch(setOpenNowWidth(openNow));
    },
  });

const mounted = () => screen.findByRole('button', { name: 'Sort sessions' });
const grip = () => screen.getByRole('separator', { name: NAME });
const noGrip = () => screen.queryByRole('separator', { name: NAME });

// The list's grid track, resolved the way a browser substitutes its var().
function listTrack(): string {
  const pane = document.querySelector<HTMLElement>('[data-pane="sessions"]');
  const grid = pane?.parentElement;
  if (!grid) throw new Error('no sessions pane in a grid');
  const style = getComputedStyle(grid);
  const first = style.gridTemplateColumns.split(' ')[0];
  const variable = /^var\((--[\w-]+)\)$/.exec(first);
  if (variable === null) return first;
  const value = style.getPropertyValue(variable[1]).trim();
  if (value === '') throw new Error(`${variable[1]} is not set on the grid`);
  return value;
}

// The width as saved on this device, or null for "the default".
function storedWidth(): number | null {
  const raw = localStorage.getItem('settingsData');
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' &&
    parsed !== null &&
    'listWidth' in parsed &&
    typeof parsed.listWidth === 'number'
    ? parsed.listWidth
    : null;
}

const widthWrites = (seen: string[]) =>
  seen.filter((type) => type === SET_WIDTH).length;

const press = (x: number) =>
  fireEvent.pointerDown(grip(), { clientX: x, clientY: 300, button: 0 });
const moveTo = (x: number) =>
  fireEvent.pointerMove(window, { clientX: x, clientY: 300 });
const release = (x: number) =>
  fireEvent.pointerUp(window, { clientX: x, clientY: 300 });

beforeEach(() => {
  localStorage.clear();
  setViewportWidth(1600);
  history.replaceState(null, '', '?view=tab');
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: ORIGINAL_INNER_WIDTH,
  });
  document.documentElement.removeAttribute('data-resizing');
});

describe('the grip is a separator', () => {
  test('named, vertical, with the shown width and its range', async () => {
    await renderHome();
    await mounted();

    const separator = grip();
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('aria-valuenow', '400');
    expect(separator).toHaveAttribute('aria-valuemin', '356');
    expect(separator).toHaveAttribute('aria-valuemax', '520');
    expect(separator).toHaveAttribute('tabindex', '0');
    // Inside no pane, so no row drag can start from it.
    expect(separator.closest('[data-pane]')).toBeNull();
    expect(listTrack()).toBe('400px');
  });

  // Open now's grip keeps its own marker; the tour and its specs find it by that.
  test("it is not Open now's grip", async () => {
    await renderHome();
    await mounted();
    expect(grip()).not.toHaveAttribute('data-resize-grip');
    expect(document.querySelectorAll('[data-resize-grip]')).toHaveLength(1);
  });
});

describe('where it shows', () => {
  test('not below 1100px, where the list is 356, folded or not', async () => {
    await renderHome({ list: 500 });
    await mounted();
    setViewportWidth(1099);
    expect(noGrip()).toBeNull();
    expect(listTrack()).toBe('356px');
  });

  test('not side by side at 1280, where the saved session has no room to give', async () => {
    setViewportWidth(1280);
    await renderHome();
    await mounted();
    expect(noGrip()).toBeNull();
  });

  test('folded at 1280 it shows, up to the 600 cap', async () => {
    setViewportWidth(1280);
    await renderHome({ fold: true });
    await mounted();
    expect(grip()).toHaveAttribute('aria-valuenow', '356');
    expect(grip()).toHaveAttribute('aria-valuemax', '600');
  });

  test('not in Settings, and back from Settings the width is back', async () => {
    const { store } = await renderHome({ list: 450 });
    await mounted();
    await act(async () => {
      await store.dispatch(openSettingsPage(undefined));
    });
    // PREMISE: Settings replaced Open now.
    expect(document.querySelector('[data-pane="open-now"]')).toBeNull();
    expect(noGrip()).toBeNull();
    act(() => {
      store.dispatch(closeSettingsPage());
    });
    expect(grip()).toHaveAttribute('aria-valuenow', '450');
    expect(listTrack()).toBe('450px');
  });

  test('not in the popup', async () => {
    history.replaceState(null, '', '/');
    await renderHome();
    await mounted();
    expect(noGrip()).toBeNull();
  });
});

describe('the arrow keys', () => {
  test('ArrowRight widens the list 16px, ArrowLeft narrows it, each saved', async () => {
    await renderHome();
    await mounted();

    expect(fireEvent.keyDown(grip(), { key: 'ArrowRight' })).toBe(false);
    expect(storedWidth()).toBe(416);
    expect(listTrack()).toBe('416px');

    expect(fireEvent.keyDown(grip(), { key: 'ArrowLeft' })).toBe(false);
    expect(storedWidth()).toBe(400);
    expect(grip()).toHaveAttribute('aria-valuenow', '400');
  });

  test('ArrowRight at the max saves nothing', async () => {
    const { seen } = await renderHome({ list: 520 });
    await mounted();
    const writesBefore = widthWrites(seen);
    expect(fireEvent.keyDown(grip(), { key: 'ArrowRight' })).toBe(false);
    expect(widthWrites(seen)).toBe(writesBefore);
  });
});

describe('each max reads the other (KAN-687 comment 11077)', () => {
  test("a wider Open now lowers the list's max", async () => {
    setViewportWidth(1920);
    await renderHome({ openNow: 900 });
    await mounted();
    expect(grip()).toHaveAttribute('aria-valuemax', String(1920 - 900 - 480));
  });

  test("a wider list lowers Open now's max", async () => {
    setViewportWidth(1920);
    await renderHome({ list: 600 });
    await mounted();
    const openNowGrip = screen.getByRole('separator', {
      name: 'Resize Open now',
    });
    expect(openNowGrip).toHaveAttribute(
      'aria-valuemax',
      String(1920 - 600 - 480)
    );
  });

  test('a list drag leaves Open now where it is', async () => {
    await renderHome();
    await mounted();
    press(400);
    moveTo(480);
    expect(listTrack()).toBe('480px');
    expect(openNowTrack()).toBe('600px');
    release(480);
  });
});

describe('the pointer drag', () => {
  test('dragging right widens the list live, and the release saves it', async () => {
    await renderHome();
    await mounted();
    press(400);
    moveTo(450);
    expect(listTrack()).toBe('450px');
    expect(storedWidth()).toBeNull();
    release(450);
    expect(storedWidth()).toBe(450);
  });

  test('the drag stops at the range', async () => {
    await renderHome();
    await mounted();
    press(400);
    moveTo(900);
    expect(listTrack()).toBe('520px');
    moveTo(0);
    expect(listTrack()).toBe('356px');
    release(0);
    expect(storedWidth()).toBe(356);
  });

  // A release saves the width it shows: after the window narrows mid-drag,
  // the next move clamps to the narrower window's range, not the old one.
  test('a window narrowed mid-drag: the release saves the width shown', async () => {
    await renderHome();
    await mounted();
    press(400);
    moveTo(600);
    // PREMISE: the drag reached 1600's max.
    expect(listTrack()).toBe('520px');
    setViewportWidth(1440);
    moveTo(601);
    expect(listTrack()).toBe('420px');
    release(601);
    expect(storedWidth()).toBe(420);
  });

  test('Escape mid-drag puts the width back and saves nothing', async () => {
    const { seen } = await renderHome();
    await mounted();
    press(400);
    moveTo(480);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(listTrack()).toBe('400px');
    release(480);
    expect(widthWrites(seen)).toBe(0);
  });
});

describe('the double-click', () => {
  test('resets a saved width to the default', async () => {
    await renderHome({ list: 500 });
    await mounted();
    fireEvent.doubleClick(grip());
    expect(storedWidth()).toBeNull();
    expect(listTrack()).toBe('400px');
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
        name: 'Breite der Liste der gespeicherten Sitzungen ändern',
      })
    ).toBeInTheDocument();
    expect(noGrip()).not.toBeInTheDocument();

    // The i18n instance is shared: back to English while still mounted.
    await act(async () => {
      await testI18n.changeLanguage('en');
    });
  });
});
