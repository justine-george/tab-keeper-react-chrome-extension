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

// Folded, Open now fills the tab view and no saved session is shown, so the
// selected row does not draw its selection fill: the selection stays in state,
// it is just not drawn. A peek shows the clicked session, and so lights it.
// The selected row carries no ARIA state, so there is nothing else to follow.

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

describe('the selected row draws its fill only while its session is shown', () => {
  test('folded: hover still fills the selected row', async () => {
    await renderHome();
    await mounted();

    expect(hoverRulesFor(rowOf('First session'))).toMatch(
      new RegExp(`inset 0 0 0 100vw ${LIGHT_THEME.HOVER_COLOR}`, 'i')
    );
  });
});
