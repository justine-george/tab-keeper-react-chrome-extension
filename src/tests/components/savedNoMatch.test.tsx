import { afterEach, describe, expect, test } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  peekSavedSession,
  setHasTabGroupsPermission,
} from '../../redux/slices/globalStateSlice';
import {
  setFoldSavedSessionInTabView,
  setTheme,
  Theme,
} from '../../redux/slices/settingsDataStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-385 R4. A search that matches nothing puts one composed block where the
// saved session would have been: the detail pane, or the list when there is none.

const NAME = 'Search saved tabs';
const MESSAGE = 'No saved tab matches "zzz"';
const HINT =
  'Search looks in session names, window names, tab titles and links.';

const seedOne = (store: RenderWithProvidersResult['store']) => {
  store.dispatch(setHasTabGroupsPermission(false));
  store.dispatch(
    saveToTabContainerInternal(
      buildSession({ tabGroupId: 'r', title: 'Research' })
    )
  );
};

const render = (
  view: 'popup' | 'tab',
  prepare: (store: RenderWithProvidersResult['store']) => void = () => {}
) => {
  history.replaceState(null, '', view === 'tab' ? '?view=tab' : '/');
  return renderWithProviders(<MainContainer />, {
    seedStore: (store) => {
      seedOne(store);
      prepare(store);
    },
  });
};

const type = async (text: string) => {
  const field = await screen.findByRole('textbox', { name: NAME });
  act(() => {
    fireEvent.change(field, { target: { value: text } });
  });
};

const pane = (name: 'sessions' | 'detail') =>
  document.querySelector(`[data-pane="${name}"]`);

const holds = (name: 'sessions' | 'detail', text: string) =>
  pane(name)?.textContent?.includes(text) ?? false;

const hintCount = () => screen.queryAllByText(HINT).length;
const messageCount = () => screen.queryAllByText(MESSAGE).length;

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('the popup', () => {
  test('the detail pane holds the message and the hint, the list neither', async () => {
    await render('popup');
    await type('zzz');

    expect(holds('detail', MESSAGE)).toBe(true);
    expect(holds('detail', HINT)).toBe(true);
    expect(holds('sessions', MESSAGE)).toBe(false);
    expect(holds('sessions', HINT)).toBe(false);
    expect(messageCount()).toBe(1);
    expect(hintCount()).toBe(1);
  });

  test('the drawing is hidden from assistive tech and cannot take focus', async () => {
    await render('popup');
    await type('zzz');

    const art = pane('detail')?.querySelector('svg');
    expect(art).toHaveAttribute('aria-hidden', 'true');
    expect(art).toHaveAttribute('focusable', 'false');
  });

  test('the message is the trimmed query', async () => {
    await render('popup');
    await type('  zzz ');

    expect(messageCount()).toBe(1);
  });

  test('a match, or spaces alone, shows no block', async () => {
    await render('popup');
    await type('research');
    expect(messageCount()).toBe(0);
    expect(hintCount()).toBe(0);

    await type('   ');
    expect(messageCount()).toBe(0);
    expect(hintCount()).toBe(0);
  });
});

describe('the tab view', () => {
  test('folded, the list holds the block and no detail column is drawn', async () => {
    await render('tab', (store) =>
      store.dispatch(setFoldSavedSessionInTabView(true))
    );
    await type('zzz');

    expect(pane('detail')).toBeNull();
    expect(holds('sessions', MESSAGE)).toBe(true);
    expect(holds('sessions', HINT)).toBe(true);
    expect(messageCount()).toBe(1);
    expect(hintCount()).toBe(1);
  });

  test('unfolded, the detail column holds it and the list does not', async () => {
    await render('tab', (store) =>
      store.dispatch(setFoldSavedSessionInTabView(false))
    );
    await type('zzz');

    expect(holds('detail', MESSAGE)).toBe(true);
    expect(holds('detail', HINT)).toBe(true);
    expect(holds('sessions', MESSAGE)).toBe(false);
    expect(holds('sessions', HINT)).toBe(false);
    expect(messageCount()).toBe(1);
  });

  test('folded but peeking, the detail column draws it and the list does not', async () => {
    await render('tab', (store) => {
      store.dispatch(setFoldSavedSessionInTabView(true));
      store.dispatch(peekSavedSession());
    });
    await type('zzz');

    expect(holds('detail', MESSAGE)).toBe(true);
    expect(holds('sessions', MESSAGE)).toBe(false);
    expect(messageCount()).toBe(1);
  });

  test('a match shows no block in either', async () => {
    await render('tab', (store) =>
      store.dispatch(setFoldSavedSessionInTabView(true))
    );
    await type('research');

    expect(messageCount()).toBe(0);
    expect(hintCount()).toBe(0);
  });
});

describe('the drawing disc', () => {
  const discOpacity = () =>
    pane('detail')?.querySelector('svg circle')?.getAttribute('opacity');

  test.each([
    [Theme.LIGHT, '0.12'],
    [Theme.WARM_LIGHT, '0.12'],
    [Theme.BB_PINK, '0.12'],
    [Theme.DARKENHEIMER, '0.14'],
    [Theme.BLUE, '0.14'],
  ])('%s draws it at %s', async (theme, opacity) => {
    await render('popup', (store) => store.dispatch(setTheme(theme)));
    await type('zzz');

    expect(discOpacity()).toBe(opacity);
  });
});
