import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { ADDABLE_REFRESH_COALESCE_MS } from '../../hooks/useCurrentWindowHasTabsToAdd';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setupChromeFake } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-886. With only Tab Keeper in the current window, Add current window dims
// (header chip) or is left out (row menu), and follows the window's tabs live.
const ADD = 'Add current window';
const ADD_TOOLTIP = 'Add current window to this session';
const NOTHING = 'Nothing to add: only Tab Keeper is open in this window';

function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html?view=tab');
  scratch.restore();
  return url;
}
const TAB_VIEW_URL = tabViewUrl();

function Both() {
  return (
    <>
      <TabGroupEntryContainer />
      <HeroContainerRight />
    </>
  );
}

const render = (withRealTab: boolean) =>
  renderWithProviders(<Both />, {
    seed: {
      platformOs: 'mac',
      currentTabId: 10,
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, url: TAB_VIEW_URL, title: 'Tab Keeper' },
            ...(withRealTab
              ? [{ id: 11, url: 'https://a.test/', title: 'A' }]
              : []),
          ],
        },
      ],
    },
    seedStore: (store) => {
      store.dispatch(
        replaceState(
          buildContainer([
            buildSession({ tabGroupId: 'shown', title: 'Roadmap' }),
          ])
        )
      );
      store.dispatch(selectTabContainer('shown'));
    },
  });

const chip = () => screen.getByRole('button', { name: ADD });
const addsWindow = (seen: string[]) =>
  seen.some((type) => type.startsWith('global/addCurrWindowToTabGroup'));
const rowMenuLabels = () => {
  const list = document.querySelector<HTMLElement>('[data-session-column]');
  if (list === null) throw new Error('no session list');
  fireEvent.contextMenu(within(list).getByRole('button', { name: /^Roadmap/ }));
  const menu = document.querySelector<HTMLElement>('[data-row-menu]');
  if (menu === null) throw new Error('no row menu');
  return within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.getAttribute('aria-label') ?? i.textContent ?? '');
};

afterEach(() => {
  vi.useRealTimers();
});

describe('Add current window with nothing to add (KAN-886)', () => {
  test('the chip dims, says why, and stays in the tab order', async () => {
    await render(false);
    await waitFor(() =>
      expect(chip()).toHaveAttribute('aria-disabled', 'true')
    );
    expect(chip()).toHaveAttribute('data-tooltip', NOTHING);
    expect(chip()).toHaveAttribute('aria-description', NOTHING);
    expect(getComputedStyle(chip()).opacity).toBe('0.3');
    expect(chip()).not.toHaveAttribute('disabled');
  });

  test('a click on the dimmed chip does nothing', async () => {
    const user = userEvent.setup();
    const { seen } = await render(false);
    await waitFor(() =>
      expect(chip()).toHaveAttribute('aria-disabled', 'true')
    );
    const before = seen.length;
    await user.click(chip());
    chip().focus();
    await user.keyboard('{Enter} ');
    expect(seen.slice(before)).toEqual([]);
  });

  test('with a real tab the chip is as today and adds the window', async () => {
    const user = userEvent.setup();
    const { seen } = await render(true);
    // Let the first read settle before asserting it stayed enabled.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(chip()).not.toHaveAttribute('aria-disabled');
    expect(chip()).toHaveAttribute('data-tooltip', ADD_TOOLTIP);
    expect(getComputedStyle(chip()).opacity).not.toBe('0.3');
    await user.click(chip());
    await waitFor(() => expect(addsWindow(seen)).toBe(true));
  });

  test('a real tab opened in the window turns the chip back on', async () => {
    const { chrome: fake } = await render(false);
    await waitFor(() =>
      expect(chip()).toHaveAttribute('aria-disabled', 'true')
    );
    act(() => {
      fake.browser.openTab(1, { url: 'https://c.test/' });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, ADDABLE_REFRESH_COALESCE_MS + 10));
    });
    expect(chip()).not.toHaveAttribute('aria-disabled');
    expect(chip()).toHaveAttribute('data-tooltip', ADD_TOOLTIP);
  });

  test('the row menu leaves Add current window out', async () => {
    await render(false);
    await waitFor(() =>
      expect(chip()).toHaveAttribute('aria-disabled', 'true')
    );
    expect(rowMenuLabels().some((l) => l.includes(ADD_TOOLTIP))).toBe(false);
  });

  test('with a real tab the row menu offers it', async () => {
    await render(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(rowMenuLabels().some((l) => l.includes(ADD_TOOLTIP))).toBe(true);
  });
});
