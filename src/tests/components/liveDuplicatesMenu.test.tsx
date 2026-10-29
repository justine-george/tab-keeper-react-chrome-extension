import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { Toast } from '../../components/common/Toast';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-867. A live window's ⋮ and right-click offer Remove N duplicate tabs
// after the sorts and before Close window, while it has a copy; the header's
// right-click offers it last with the sum, while any window has one.

afterEach(() => {
  fireEvent.keyDown(document.body, { key: 'Escape' });
});

const url = (host: string) => `https://${host}.test/`;
let nextId = 100;
const tab = (host: string, extra: Partial<chrome.tabs.Tab> = {}) => ({
  id: ++nextId,
  title: host,
  url: url(host),
  ...extra,
});

// W1 is This window. W2 repeats a twice; W3 repeats b once; W4 has none.
const SEED = (): ChromeSeed => ({
  grantedPermissions: ['tabGroups'],
  windows: [
    { id: 1, focused: true, tabs: [tab('home', { active: true })] },
    {
      id: 2,
      tabs: [tab('a', { active: true }), tab('a'), tab('c'), tab('a')],
    },
    { id: 3, tabs: [tab('b'), tab('b', { active: true })] },
    { id: 4, tabs: [tab('d', { active: true }), tab('a')] },
  ],
});

async function renderOpenNow(seed: ChromeSeed) {
  const result = await renderWithProviders(
    <>
      <OpenNowColumn folded={true} />
      <Toast />
    </>,
    {
      seed,
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
      },
    }
  );
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return result;
}

const blockOf = (windowId: number) => {
  const block = document.querySelector(`[data-open-window-id="${windowId}"]`);
  if (!(block instanceof HTMLElement)) throw new Error('no window block');
  return block;
};
const menuKeys = () =>
  within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((i) => i.getAttribute('data-menu-item'));
const openWindowMenu = async (
  user: ReturnType<typeof userEvent.setup>,
  windowId: number
) => {
  await user.click(
    within(blockOf(windowId)).getByRole('button', {
      name: `More actions: Window ${windowId}`,
    })
  );
};
const header = () => {
  const el = document.querySelector('[data-open-now-header]');
  if (!(el instanceof HTMLElement)) throw new Error('no Open now header');
  return el;
};
const openHeaderMenu = () =>
  fireEvent.contextMenu(
    within(header()).getByRole('heading', { name: 'Currently open' })
  );
const urlsIn = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((x, y) => x.index - y.index)
    .map((t) => t.url);

describe('Remove duplicate tabs in Currently open (KAN-867)', () => {
  test('a window ⋮ lists it with its own count, after the sorts and before Close window', async () => {
    const user = userEvent.setup();
    await renderOpenNow(SEED());
    await openWindowMenu(user, 2);
    const keys = menuKeys();
    expect(keys.slice(-2)).toEqual(['duplicates', 'closeWindow']);
    expect(keys.indexOf('sortBySite')).toBeLessThan(keys.indexOf('duplicates'));
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Remove 2 duplicate tabs',
      })
    ).toBeInTheDocument();
  });

  test('a window with no copy of its own does not list it', async () => {
    const user = userEvent.setup();
    await renderOpenNow(SEED());
    await openWindowMenu(user, 4);
    expect(menuKeys()).not.toContain('duplicates');
  });

  test('the window right-click lists it too', async () => {
    await renderOpenNow(SEED());
    const row = blockOf(3).querySelector<HTMLElement>('[data-window-row]');
    fireEvent.contextMenu(row ?? blockOf(3));
    expect(menuKeys()).toContain('duplicates');
  });

  test("choosing it closes only that window's copies and offers one Reopen", async () => {
    const user = userEvent.setup();
    await renderOpenNow(SEED());
    await openWindowMenu(user, 2);
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Remove 2 duplicate tabs',
      })
    );
    await waitFor(async () =>
      expect(await urlsIn(2)).toEqual([url('a'), url('c')])
    );
    expect(await urlsIn(3)).toEqual([url('b'), url('b')]);
    expect(await screen.findByText('Closed 2 duplicate tabs.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(async () =>
      expect(await urlsIn(2)).toEqual([url('a'), url('a'), url('c'), url('a')])
    );
  });

  test("the header right-click lists it last, with every window's copies summed", async () => {
    await renderOpenNow(SEED());
    openHeaderMenu();
    const keys = menuKeys();
    expect(keys[keys.length - 1]).toBe('duplicates');
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Remove 3 duplicate tabs',
      })
    ).toBeInTheDocument();
  });

  test("choosing it in the header closes every window's copies", async () => {
    const user = userEvent.setup();
    await renderOpenNow(SEED());
    openHeaderMenu();
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Remove 3 duplicate tabs',
      })
    );
    await waitFor(async () => expect(await urlsIn(3)).toEqual([url('b')]));
    expect(await urlsIn(2)).toEqual([url('a'), url('c')]);
    expect(await urlsIn(4)).toEqual([url('d'), url('a')]);
    expect(await screen.findByText('Closed 3 duplicate tabs.')).toBeVisible();
  });

  test('the header leaves it out with no copy anywhere', async () => {
    await renderOpenNow({
      windows: [
        { id: 1, focused: true, tabs: [tab('home', { active: true })] },
        { id: 2, tabs: [tab('a', { active: true }), tab('b')] },
        { id: 3, tabs: [tab('a', { active: true })] },
      ],
    });
    openHeaderMenu();
    expect(menuKeys()).not.toContain('duplicates');
  });

  test('the header leaves it out while the Open now search holds text', async () => {
    const user = userEvent.setup();
    await renderOpenNow(SEED());
    await user.type(
      screen.getByRole('textbox', { name: 'Search open tabs' }),
      'a'
    );
    openHeaderMenu();
    expect(menuKeys()).not.toContain('duplicates');
  });
});
