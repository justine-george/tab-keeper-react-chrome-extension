import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { openNowTrack } from '../setup/openNowTrack';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-321 O1a. A grip drag changes one grid track per pointermove. None of
// the three panes has anything to redraw for that, so none of them may
// re-render: each re-render reconciles the saved list, the detail and every
// live window's tabs, once per pixel of the drag.
//
// Each pane's render is counted through a child it always renders, wrapped
// here in a component that counts its own renders and has no reason of its
// own to re-render. A pane that re-renders re-renders that child; a pane that
// does not, does not.
const renders = vi.hoisted(() => ({ left: 0, right: 0, openNow: 0 }));

vi.mock('../../components/home/leftpane/HeroContainerLeft', async (load) => {
  const actual =
    await load<
      typeof import('../../components/home/leftpane/HeroContainerLeft')
    >();
  const Real = actual.default;
  return {
    ...actual,
    default: function CountedHeroContainerLeft() {
      renders.left += 1;
      return <Real />;
    },
  };
});

vi.mock('../../components/home/rightpane/HeroContainerRight', async (load) => {
  const actual =
    await load<
      typeof import('../../components/home/rightpane/HeroContainerRight')
    >();
  const Real = actual.default;
  return {
    ...actual,
    default: function CountedHeroContainerRight() {
      renders.right += 1;
      return <Real />;
    },
  };
});

vi.mock('../../components/home/opennow/OpenNowPane', async (load) => {
  const actual =
    await load<typeof import('../../components/home/opennow/OpenNowPane')>();
  const Real = actual.default;
  return {
    ...actual,
    default: function CountedOpenNowPane(props: ComponentProps<typeof Real>) {
      renders.openNow += 1;
      return <Real {...props} />;
    },
  };
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;

beforeEach(() => {
  localStorage.clear();
  act(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1600,
    });
  });
  history.replaceState(null, '', '?view=tab');
});

afterEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: ORIGINAL_INNER_WIDTH,
  });
  document.documentElement.removeAttribute('data-resizing');
});

test('a pointermove in a grip drag re-renders none of the three panes, and keeps the grid class', async () => {
  await renderWithProviders(<MainContainer />, {
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: 'first', title: 'First session' })
        )
      );
      store.dispatch(selectTabContainer('first'));
      store.dispatch(setFoldSavedSessionInTabView(false));
    },
  });
  // Settled: the app has mounted and Open now has read its windows.
  await screen.findByRole('button', { name: 'Sort sessions' });
  await screen.findByText('Updates as you browse');
  await act(async () => {});
  // PREMISE: every counter is live.
  expect(renders.left).toBeGreaterThan(0);
  expect(renders.right).toBeGreaterThan(0);
  expect(renders.openNow).toBeGreaterThan(0);
  const before = { ...renders };
  // The grid's Emotion class: a width baked into it would mint a new class,
  // and insert a stylesheet rule, per pixel of the drag.
  const grid = document.querySelector('[data-pane="open-now"]')?.parentElement;
  if (grid == null) throw new Error('no grid');
  const gridClass = grid.className;

  const grip = screen.getByRole('separator', { name: 'Resize Open now' });
  fireEvent.pointerDown(grip, { clientX: 1000, clientY: 300, button: 0 });
  fireEvent.pointerMove(window, { clientX: 950, clientY: 300 });
  fireEvent.pointerMove(window, { clientX: 925, clientY: 300 });
  fireEvent.pointerMove(window, { clientX: 900, clientY: 300 });

  // PREMISE: the moves took effect.
  expect(openNowTrack()).toBe('722px');
  expect(grip).toHaveAttribute('aria-valuenow', '722');
  expect({ ...renders }).toEqual(before);
  expect(grid.className).toBe(gridClass);

  fireEvent.pointerUp(window, { clientX: 900, clientY: 300 });
});
