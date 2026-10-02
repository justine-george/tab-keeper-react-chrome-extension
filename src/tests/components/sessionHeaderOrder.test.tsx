import { afterEach, describe, expect, test } from 'vitest';
import { within } from '@testing-library/react';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-377. Collapse all leads, as in Open now; More stays last.

const SESSION = buildSession({ tabGroupId: 'session-kyoto' });

afterEach(() => history.replaceState(null, '', '/'));

const headerNames = async () => {
  const { container } = await renderWithProviders(<HeroContainerRight />, {
    seed: { windows: [{ id: 1 }] },
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SESSION])));
      store.dispatch(selectTabContainer('session-kyoto'));
    },
  });
  const strip = container.querySelector('[data-session-toolbar] > div');
  if (!(strip instanceof HTMLElement)) throw new Error('no toolbar strip');
  return within(strip)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));
};

describe('the session header order (KAN-377)', () => {
  test('popup: Collapse all, Open, Switch, More', async () => {
    expect(await headerNames()).toEqual([
      'Collapse all windows',
      'Open session, keeping current windows',
      'Close current windows and open this session',
      'More actions',
    ]);
  });

  test('tab view: Collapse all, Open, More', async () => {
    history.replaceState(null, '', '?view=tab');
    expect(await headerNames()).toEqual([
      'Collapse all windows',
      'Open session, keeping current windows',
      'More actions',
    ]);
  });
});
