import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { hoverRulesFor } from '../setup/hoverRules';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';
import { LIGHT_THEME } from '../../hooks/useThemeColors';

// KAN-999 (his pick D4). Folded, the selected row still draws its selection,
// hover included, as unfolded: the saved session's card says where its
// session went. The selected row carries no ARIA state, so there is nothing
// else to follow.

const goToTabView = () => history.replaceState(null, '', '?view=tab');

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

const mounted = () => screen.findByRole('button', { name: 'Sort sessions' });

beforeEach(() => {
  localStorage.clear();
  goToTabView();
});
afterEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('the selected row draws its fill folded too', () => {
  // CONTROL: an unselected row does get the hover fill.
  test('folded: hover fills an unselected row', async () => {
    await renderHome();
    await mounted();

    expect(hoverRulesFor(rowOf('Second session'))).toMatch(
      new RegExp(`inset 0 0 0 100vw ${LIGHT_THEME.HOVER_COLOR}`, 'i')
    );
  });

  test('folded: hover draws no fill over the selected row', async () => {
    await renderHome();
    await mounted();

    // No hover fill over it: its selection fill stays (the e2e reads the color).
    expect(hoverRulesFor(rowOf('First session'))).not.toMatch(
      new RegExp(`inset 0 0 0 100vw ${LIGHT_THEME.HOVER_COLOR}`, 'i')
    );
  });
});
