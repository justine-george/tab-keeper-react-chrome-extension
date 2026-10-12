import { afterEach, describe, expect, test } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildChromeTab as tab } from '../fixtures/chromeTab';
import { toastTexts } from '../setup/toasts';

// KAN-522. With nothing open but Tab Keeper, the save row's three actions said nothing: the saves returned on an
// empty capture, and Export opened a tab with nothing in it. Each now says why, and does nothing else.

const OWN_URL = 'chrome-extension://faketestid/index.html?view=tab';
const NOTHING_TO_SAVE = 'No tabs to save. Only Tab Keeper is open.';
const NOTHING_IN_WINDOW =
  'No tabs to save in this window. Only Tab Keeper is open here.';
const NOTHING_TO_EXPORT = 'No tabs to export. Only Tab Keeper is open.';

const own = (id: number, windowId = 1) =>
  tab({ id, windowId, url: OWN_URL, title: 'Tab Keeper', active: true });

const onlyTabKeeper = {
  windows: [{ id: 1, tabs: [own(10)] }],
  currentTabId: 10,
};
// This window holds only Tab Keeper; another window has a real tab.
const otherWindowHasTabs = {
  windows: [
    { id: 1, tabs: [own(10)] },
    {
      id: 2,
      tabs: [
        tab({ id: 20, windowId: 2, url: 'https://docs.test/', title: 'Docs' }),
      ],
    },
  ],
  currentTabId: 10,
};

afterEach(() => history.replaceState(null, '', '/'));

const render = async (seed: typeof onlyTabKeeper) => {
  history.replaceState(null, '', '?view=tab');
  const result = await renderWithProviders(<UserInputContainer />, { seed });
  await act(async () => {});
  return result;
};
const menuItem = async (name: string) => {
  await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
  return within(screen.getByRole('menu')).getByRole('menuitem', { name });
};
const saveAll = () =>
  userEvent.click(
    screen.getByRole('button', { name: 'Save all open windows as a session' })
  );

describe('with only Tab Keeper open, each save-row action says why (KAN-522)', () => {
  test('Save all open windows: the toast, and no session', async () => {
    const { store } = await render(onlyTabKeeper);
    await saveAll();
    expect(toastTexts(store.getState())).toEqual([NOTHING_TO_SAVE]);
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
  });

  test('Save current window: the per-window toast, and no session', async () => {
    const { store } = await render(otherWindowHasTabs);
    await userEvent.click(await menuItem('Save current window as a session'));
    expect(toastTexts(store.getState())).toEqual([NOTHING_IN_WINDOW]);
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
  });

  test('CONTROL: in that same seed, Save all open windows saves the other window', async () => {
    const { store } = await render(otherWindowHasTabs);
    await saveAll();
    expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(1);
    expect(toastTexts(store.getState())).not.toContain(NOTHING_TO_SAVE);
  });

  test('Export open windows: the toast, and no export tab opened', async () => {
    const { store, chrome } = await render(onlyTabKeeper);
    await userEvent.click(await menuItem('Export open windows…'));
    await act(async () => {});
    expect(toastTexts(store.getState())).toEqual([NOTHING_TO_EXPORT]);
    expect(chrome.createdTabs).toEqual([]);
  });

  test('CONTROL: with a real tab open, Export open windows opens the export page', async () => {
    const { store, chrome } = await render(otherWindowHasTabs);
    await userEvent.click(await menuItem('Export open windows…'));
    await act(async () => {});
    expect(chrome.createdTabs).toHaveLength(1);
    expect(chrome.createdTabs[0].url).toContain(
      'export.html?source=open-windows'
    );
    expect(toastTexts(store.getState())).toEqual([]);
  });
});
