import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { hoverRulesFor } from '../setup/hoverRules';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';
import { LIGHT_THEME } from '../../hooks/useThemeColors';

// Folded, Open now fills the tab view and no saved session is shown, so the
// selected row does not draw its selection fill: the selection stays in state,
// it is just not drawn. A peek shows the clicked session, and so lights it.
// The selected row carries no ARIA state, so there is nothing else to follow.

const FOLD = 'Fold the saved session away';
const UNFOLD = 'Show the saved session';

const goToTabView = () => history.replaceState(null, '', '?view=tab');

const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};
const SELECTED = rgb(LIGHT_THEME.SELECTION_COLOR);

const renderHome = () =>
  renderWithProviders(<MainContainer />, {
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: 'second', title: 'Second session' })
        )
      );
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: 'first', title: 'First session' })
        )
      );
      store.dispatch(selectTabContainer('first'));
    },
  });

const rowButton = (title: string) => {
  const sessions = document.querySelector<HTMLElement>(
    '[data-pane="sessions"]'
  );
  if (sessions === null) throw new Error('no sessions pane');
  return within(sessions).getByRole('button', { name: title });
};
const rowOf = (title: string) => {
  const row = rowButton(title).parentElement;
  if (row === null) throw new Error('row has no container');
  return row;
};
const fillOf = (title: string) =>
  getComputedStyle(rowOf(title)).backgroundColor;

const mounted = () => screen.findByRole('button', { name: 'Sort sessions' });

beforeEach(() => {
  localStorage.clear();
  goToTabView();
});
afterEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('the selected row draws its fill only while its session is shown', () => {
  test('folded: no selection fill, and the store still has it selected', async () => {
    const { store } = await renderHome();
    await mounted();

    expect(fillOf('First session')).not.toBe(SELECTED);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'first'
    );
  });

  test('unfolded: the fill is there', async () => {
    await renderHome();
    await mounted();
    fireEvent.click(screen.getByRole('button', { name: UNFOLD }));

    expect(fillOf('First session')).toBe(SELECTED);
    expect(fillOf('Second session')).not.toBe(SELECTED);
  });

  test('folded then unfolded: the fill comes back on the same row; folding again removes it', async () => {
    await renderHome();
    await mounted();
    expect(fillOf('First session')).not.toBe(SELECTED);

    fireEvent.click(screen.getByRole('button', { name: UNFOLD }));
    expect(fillOf('First session')).toBe(SELECTED);

    fireEvent.click(screen.getByRole('button', { name: FOLD }));
    expect(fillOf('First session')).not.toBe(SELECTED);
  });

  test('folded, peeking: the peeked row is lit, the old one is not', async () => {
    const { store } = await renderHome();
    await mounted();

    fireEvent.click(rowButton('Second session'));

    expect(store.getState().globalState.isPeekingSavedSession).toBe(true);
    expect(fillOf('Second session')).toBe(SELECTED);
    expect(fillOf('First session')).not.toBe(SELECTED);
  });

  test('folded: hover still fills the selected row', async () => {
    await renderHome();
    await mounted();

    expect(hoverRulesFor(rowOf('First session'))).toMatch(
      new RegExp(`inset 0 0 0 100vw ${LIGHT_THEME.HOVER_COLOR}`, 'i')
    );
  });

  test('the popup is never folded: the selected row is filled', async () => {
    history.replaceState(null, '', '/');
    await renderHome();
    await mounted();

    expect(fillOf('First session')).toBe(SELECTED);
  });
});
