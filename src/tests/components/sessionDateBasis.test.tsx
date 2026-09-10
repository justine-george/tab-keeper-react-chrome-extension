import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-141. Which date the rows show follows the date order the user chose, so
// the number on a row always describes the order the list is in.
//
// The preference lives in device-local settings, NOT on the container:
// saveToFirestore sends tabContainerData and nothing else, so keeping it here
// costs no merge rule -- the same reasoning that kept the sort mode derived in
// KAN-130 and KAN-136 rather than stored.

const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

const session = (id: string, at: number) => ({
  tabGroupId: id,
  title: id,
  createdTime: '2026-09-09 12:00:00',
  createdAt: at,
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `${id}-w`,
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Window',
      tabs: [
        { tabId: `${id}-t`, favicon: '', title: 'Tab', url: 'https://a.co' },
      ],
    },
  ],
});

const render = () =>
  renderWithProviders(<MenuContainer />, {
    seedStore: (store) => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(T0);
        store.dispatch(saveToTabContainerInternal(session('a', T0)));
      } finally {
        vi.useRealTimers();
      }
    },
  });

const openMenu = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Sort sessions' }));

const item = (label: string) =>
  screen.getByRole('menuitemradio', { name: label });

const basisOf = (store: RenderWithProvidersResult['store']) =>
  store.getState().settingsDataState.sessionDateBasis;

const storedBasis = () => {
  const raw = localStorage.getItem('settingsData');
  return raw ? JSON.parse(raw).sessionDateBasis : undefined;
};

beforeEach(() => localStorage.clear());

describe('the date basis follows the chosen date order', () => {
  test('defaults to edited, which is the default order', async () => {
    const { store } = await render();

    expect(basisOf(store)).toBe('edited');
  });

  test('sorting by date saved switches the rows to created', async () => {
    const { store } = await render();

    openMenu();
    fireEvent.click(item('Date saved'));

    expect(basisOf(store)).toBe('created');
  });

  test('and returning to date modified switches them back', async () => {
    const { store } = await render();
    openMenu();
    fireEvent.click(item('Date saved'));
    expect(basisOf(store)).toBe('created');

    openMenu();
    fireEvent.click(item('Date modified'));

    expect(basisOf(store)).toBe('edited');
  });

  // Name and tab count are not date orders, so there is no date for them to be
  // right about -- and silently flipping the rows back to "Edited" would undo a
  // choice the user made two clicks ago. Both directions are checked, because
  // "leaves it alone" is only meaningful if it can be observed not moving from
  // a non-default value.
  test('sorting by name leaves the basis alone', async () => {
    const { store } = await render();
    openMenu();
    fireEvent.click(item('Date saved'));

    openMenu();
    fireEvent.click(item('Name'));

    expect(basisOf(store)).toBe('created');
  });

  test('sorting by tab count leaves the basis alone', async () => {
    const { store } = await render();

    openMenu();
    fireEvent.click(item('Tab count'));

    expect(basisOf(store)).toBe('edited');
  });
});

// It has to survive the popup closing, or the label would drift away from the
// order on the very next open: ranks are stored, so a date-saved sort persists,
// and a basis that reset would leave created-ordered rows labelled "Edited".
describe('the basis is remembered on this device', () => {
  test('a change is written to localStorage', async () => {
    await render();

    openMenu();
    fireEvent.click(item('Date saved'));

    expect(storedBasis()).toBe('created');
  });

  // The other half: what is written has to be what is read back. A setting
  // saved under a different key, or saved and never loaded, passes the test
  // above and still resets on every open.
  //
  // RE-IMPORTED, not merely re-rendered. The settings slice reads localStorage
  // once, at module load, to build its initialState -- which is right for a
  // popup, since the module loads fresh every time it opens, but means a second
  // store inside one test process reuses the value captured on first import.
  // resetModules is what makes this test exercise the mechanism the popup
  // actually relies on rather than a cached constant.
  test('and is read back at module load, the way a popup open reads it', async () => {
    await render();
    openMenu();
    fireEvent.click(item('Date saved'));
    expect(storedBasis()).toBe('created');

    vi.resetModules();
    const reloaded = await import('../../redux/slices/settingsDataStateSlice');

    expect(reloaded.initialState.sessionDateBasis).toBe('created');
  });

  // CONTROL for the test above. Without it, an initialState that hard-coded
  // 'created' -- or a resetModules that quietly did nothing -- would pass it.
  test('CONTROL: an untouched device loads the edited default', async () => {
    localStorage.clear();

    vi.resetModules();
    const reloaded = await import('../../redux/slices/settingsDataStateSlice');

    expect(reloaded.initialState.sessionDateBasis).toBe('edited');
  });
});
