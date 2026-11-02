import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainContainer from '../../components/MainContainer';
import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import {
  otherWay,
  savedWindowOpenWays,
  sessionMenuOpenLabelKey,
  sessionOpenLabelKey,
  windowOpenLabelKey,
} from '../../components/home/openWhere';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  recordFirstRun,
  setOpenSavedWindowsIn,
  type OpenSavedWindowsIn,
} from '../../redux/slices/settingsDataStateSlice';
import {
  runShownHere,
  runStoppedHere,
} from '../../redux/slices/globalStateSlice';
import { newRun } from '../../utils/functions/firstRun';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-892. Open follows Open saved windows; the saved window's and the session's menus offer the other way, first under the buttons.

afterEach(() => {
  fireEvent.keyDown(document.body, { key: 'Escape' });
  history.replaceState(null, '', '/');
});

const SEED: ChromeSeed = {
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [{ id: 11, url: 'https://live.test/', active: true }],
    },
  ],
};
const S1 = buildSession({ tabGroupId: 'S1', title: 'Trip' });
const S2 = buildSession({ tabGroupId: 'S2', title: 'Bravo' });

type Actions = Awaited<ReturnType<typeof renderWithProviders>>['actions'];
const argsOf = (actions: Actions, type: string) =>
  actions
    .filter((a) => a.type === type)
    .map((a) =>
      'meta' in a && typeof a.meta === 'object' && a.meta !== null
        ? Reflect.get(a.meta, 'arg')
        : undefined
    );

// The menu's items below its action row, by key.
const listKeys = (menu: HTMLElement) => {
  const top = menu.querySelector('[data-menu-action-row]');
  return within(menu)
    .getAllByRole('menuitem')
    .filter((i) => !top?.contains(i))
    .map((i) => i.getAttribute('data-menu-item'));
};
const OTHER_WAY = 'openOtherWay';
// The first item under the buttons is the other way, under this name.
const expectOtherWayFirst = (menu: HTMLElement, name: string) => {
  expect(listKeys(menu)[0]).toBe(OTHER_WAY);
  expect(
    within(menu).getByRole('menuitem', { name }).getAttribute('data-menu-item')
  ).toBe(OTHER_WAY);
};
const rowMenu = () => {
  const menu = document.querySelector<HTMLElement>('[data-row-menu]');
  if (!menu) throw new Error('no right-click menu');
  return menu;
};
const actionRowOpen = () => {
  const row = rowMenu().querySelector<HTMLElement>('[data-menu-action-row]');
  if (!row) throw new Error('no action row');
  return within(row).getByRole('menuitem', { name: 'Open' });
};

describe('openWhere', () => {
  test('the other way, and the labels each way says', () => {
    expect(otherWay('new-window')).toBe('this-window');
    expect(otherWay('this-window')).toBe('new-window');
    expect(windowOpenLabelKey('new-window')).toBe('Open in new window');
    expect(windowOpenLabelKey('this-window')).toBe('Open in this window');
    expect(sessionOpenLabelKey('new-window')).toBe('Open session');
    expect(sessionOpenLabelKey('this-window')).toBe(
      'Open session in this window'
    );
    expect(sessionMenuOpenLabelKey('new-window')).toBe(
      'Open session in new windows'
    );
    expect(sessionMenuOpenLabelKey('this-window')).toBe(
      'Open session in this window'
    );
  });

  test('a saved window opening apart: new window either way, no other way', () => {
    expect(savedWindowOpenWays('this-window', true)).toEqual({
      open: 'new-window',
      other: null,
    });
    expect(savedWindowOpenWays('new-window', true)).toEqual({
      open: 'new-window',
      other: null,
    });
    expect(savedWindowOpenWays('this-window', false)).toEqual({
      open: 'this-window',
      other: 'new-window',
    });
  });
});

describe('a saved window', () => {
  const render = (where: OpenSavedWindowsIn) =>
    renderWithProviders(<MainContainer />, {
      seed: SEED,
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([S1])));
        store.dispatch(selectTabContainer('S1'));
        store.dispatch(setOpenSavedWindowsIn(where));
      },
    });
  const block = () => {
    const found = document.querySelector<HTMLElement>('[data-drop-window-id]');
    if (!found) throw new Error('no window block');
    return found;
  };
  const kebab = () => {
    const own = within(block())
      .queryAllByRole('button', { name: 'More actions' })
      .filter((b) => !b.closest('[role="group"]'));
    expect(own).toHaveLength(1);
    return own[0];
  };
  const openButton = () =>
    within(block()).getByRole('button', {
      name: /^Open in (new|this) window: /,
    });

  test.each([
    ['new-window', 'Open in new window', 'Open in this window', 'this-window'],
    ['this-window', 'Open in this window', 'Open in new window', 'new-window'],
  ] as const)(
    '%s chosen: Open says %s; the ⋮ leads with %s, which opens that way',
    async (where, says, other, otherWhere) => {
      const user = userEvent.setup();
      const { actions } = await render(where);
      await act(async () => {});

      expect(openButton()).toHaveAccessibleName(`${says}: Morning reading`);
      expect(openButton()).toHaveAttribute('data-tooltip', says);

      await user.click(kebab());
      const menu = screen.getByRole('menu');
      expectOtherWayFirst(menu, other);
      await user.click(within(menu).getByRole('menuitem', { name: other }));
      expect(argsOf(actions, 'global/openTabsInAWindow/pending')).toEqual([
        expect.objectContaining({ tabGroupId: 'S1', where: otherWhere }),
      ]);
    }
  );

  test('the row Open leaves the way to the setting', async () => {
    const user = userEvent.setup();
    const { actions } = await render('this-window');
    await act(async () => {});
    await user.click(openButton());
    const [arg] = argsOf(actions, 'global/openTabsInAWindow/pending');
    expect(arg).toEqual(expect.objectContaining({ tabGroupId: 'S1' }));
    expect(arg).toEqual(expect.objectContaining({ where: undefined }));
  });

  test('right-click: the action row Open says the setting’s way, and the list leads with the other', async () => {
    const { actions } = await render('this-window');
    await act(async () => {});
    const row = block().querySelector<HTMLElement>('[data-window-drag-handle]');
    if (!row) throw new Error('no window row');
    fireEvent.contextMenu(row);

    expect(actionRowOpen()).toHaveAttribute(
      'aria-description',
      'Open in this window'
    );
    expectOtherWayFirst(rowMenu(), 'Open in new window');
    fireEvent.click(actionRowOpen());
    const [arg] = argsOf(actions, 'global/openTabsInAWindow/pending');
    expect(arg).toEqual(expect.objectContaining({ where: undefined }));
  });
});

// Spec 7. A saved window of the other kind than this window opens in its own
// new window whichever way is picked: Open says new window, and no other way is offered.
describe('a saved window of the other kind than this window', () => {
  const incognitoSaved = buildSession({
    tabGroupId: 'S1',
    title: 'Trip',
    windows: S1.windows.map((w) => ({ ...w, incognito: true as const })),
  });
  const render = (
    where: OpenSavedWindowsIn,
    seed: ChromeSeed,
    session = incognitoSaved
  ) =>
    renderWithProviders(<MainContainer />, {
      seed,
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([session])));
        store.dispatch(selectTabContainer('S1'));
        store.dispatch(setOpenSavedWindowsIn(where));
      },
    });
  // Past the reads of this window and the incognito allowance.
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const allowed = { ...SEED, incognitoAllowed: true };
  const block = () => {
    const found = document.querySelector<HTMLElement>('[data-drop-window-id]');
    if (!found) throw new Error('no window block');
    return found;
  };
  const openButton = () =>
    within(block()).getByRole('button', {
      name: /^Open in (new|this) window: /,
    });
  const kebabMenu = async () => {
    const own = within(block())
      .queryAllByRole('button', { name: 'More actions' })
      .filter((b) => !b.closest('[role="group"]'));
    expect(own).toHaveLength(1);
    await userEvent.setup().click(own[0]);
    return screen.getByRole('menu');
  };

  test.each(['this-window', 'new-window'] as const)(
    'an incognito saved window, this window normal, allowed in incognito, %s chosen: Open says new window, and no other way is offered',
    async (where) => {
      await render(where, allowed);
      await settle();

      expect(openButton()).toHaveAccessibleName(
        'Open in new window: Morning reading'
      );
      expect(openButton()).toHaveAttribute(
        'data-tooltip',
        'Open in new window'
      );
      expect(listKeys(await kebabMenu())).not.toContain(OTHER_WAY);
      fireEvent.keyDown(document.body, { key: 'Escape' });

      const row = block().querySelector<HTMLElement>(
        '[data-window-drag-handle]'
      );
      if (!row) throw new Error('no window row');
      fireEvent.contextMenu(row);
      expect(actionRowOpen()).toHaveAttribute(
        'aria-description',
        'Open in new window'
      );
      expect(listKeys(rowMenu())).not.toContain(OTHER_WAY);
    }
  );

  test('a normal saved window, this window incognito, allowed: the same', async () => {
    await render(
      'this-window',
      {
        ...allowed,
        windows: SEED.windows?.map((w) => ({ ...w, incognito: true })),
      },
      S1
    );
    await settle();

    expect(openButton()).toHaveAttribute('data-tooltip', 'Open in new window');
    expect(listKeys(await kebabMenu())).not.toContain(OTHER_WAY);
  });

  // Not allowed, a window saved incognito opens normal: here, as chosen.
  test('not allowed in incognito: it is this window’s kind, so Open says this window and the ⋮ offers new window', async () => {
    await render('this-window', SEED);
    await settle();

    expect(openButton()).toHaveAttribute('data-tooltip', 'Open in this window');
    expectOtherWayFirst(await kebabMenu(), 'Open in new window');
  });
});

describe('a session', () => {
  const renderBoth = (where: OpenSavedWindowsIn) =>
    renderWithProviders(
      <>
        <TabGroupEntryContainer />
        <HeroContainerRight />
      </>,
      {
        seed: SEED,
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([S1, S2])));
          store.dispatch(selectTabContainer('S1'));
          store.dispatch(setOpenSavedWindowsIn(where));
        },
      }
    );
  const rowOf = (title: string): HTMLElement => {
    const row = screen
      .getByRole('button', { name: title })
      .closest<HTMLElement>('[data-drag-handle-row]');
    if (row === null) throw new Error(`no row for ${title}`);
    return row;
  };
  const headerKebab = () =>
    screen.getByRole('button', { name: 'More actions' });

  test.each([
    [
      'new-window',
      'Open session, keeping current windows',
      'Open session in this window',
      'this-window',
    ],
    // R10. The menu's new-window item is shorter than Open's tooltip.
    [
      'this-window',
      'Open session in this window',
      'Open session in new windows',
      'new-window',
    ],
  ] as const)(
    '%s chosen: the header Open says %s; the header ⋮ leads with %s, which opens that way',
    async (where, says, other, otherWhere) => {
      const user = userEvent.setup();
      const { actions } = await renderBoth(where);

      const header = document.querySelector<HTMLElement>(
        '[data-tour-anchor="open"]'
      );
      if (!header) throw new Error('no header Open');
      const open = within(header).getByRole('button');
      expect(open).toHaveAccessibleName(says);
      expect(open).toHaveAttribute('data-tooltip', says);

      await user.click(headerKebab());
      const menu = screen.getByRole('menu');
      expectOtherWayFirst(menu, other);
      await user.click(within(menu).getByRole('menuitem', { name: other }));
      expect(argsOf(actions, 'global/openAllTabContainer/pending')).toEqual([
        expect.objectContaining({ tabGroupId: 'S1', where: otherWhere }),
      ]);
    }
  );

  test('the row’s Open tooltip follows the setting', async () => {
    await renderBoth('this-window');
    const strip = rowOf('Trip').querySelector('[data-row-actions]');
    if (!strip) throw new Error('no row actions');
    expect(
      within(strip as HTMLElement).getByRole('button', { name: 'Open' })
    ).toHaveAttribute('data-tooltip', 'Open session in this window');
  });

  test('a row’s right-click: Open says the setting’s way; the list leads with the other, for that row', async () => {
    const { actions } = await renderBoth('this-window');
    fireEvent.contextMenu(rowOf('Bravo'));

    expect(actionRowOpen()).toHaveAttribute(
      'aria-description',
      'Open session in this window'
    );
    // Before Add current window, which is otherwise first.
    expectOtherWayFirst(rowMenu(), 'Open session in new windows');
    expect(listKeys(rowMenu())[1]).toBe('add');
    fireEvent.click(
      within(rowMenu()).getByRole('menuitem', {
        name: 'Open session in new windows',
      })
    );
    expect(argsOf(actions, 'global/openAllTabContainer/pending')).toEqual([
      expect.objectContaining({ tabGroupId: 'S2', where: 'new-window' }),
    ]);
  });

  test('the header’s right-click leads its list with the other way too', async () => {
    await renderBoth('new-window');
    fireEvent.contextMenu(screen.getAllByText('Trip')[1]);
    expectOtherWayFirst(rowMenu(), 'Open session in this window');
  });
});

// The menus have no dimmed item: during the tour the other way is left out, as a saved tab's Open is.
describe('on the tour’s sample', () => {
  const SAMPLE = 'sample:x';
  const tourHere = (
    store: Awaited<ReturnType<typeof renderWithProviders>>['store']
  ) => {
    // Step 3, the Open card: step 6 (Delete) holds the header's ⋮ shut.
    store.dispatch(
      recordFirstRun({ ...newRun('popup', 3), sessionId: SAMPLE })
    );
    store.dispatch(runShownHere());
  };

  test('the saved window’s ⋮ leaves the other way out until the tour ends', async () => {
    const user = userEvent.setup();
    const onOpenWindow = vi.fn();
    const r = await renderWithProviders(
      <WindowEntryContainer
        number={1}
        title="Getting there"
        tabGroupId={SAMPLE}
        windowId="w"
        tabs={[{ tabId: 't', favicon: '', title: 'T', url: 'https://a.co' }]}
        onOpenWindow={onOpenWindow}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={() => undefined}
      />,
      { seed: SEED, seedStore: tourHere }
    );
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(listKeys(screen.getByRole('menu'))).not.toContain(OTHER_WAY);
    await user.keyboard('{Escape}');

    act(() => {
      r.store.dispatch(runStoppedHere());
    });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expectOtherWayFirst(screen.getByRole('menu'), 'Open in this window');
  });

  test('the session header’s ⋮ leaves the other way out until the tour ends', async () => {
    const user = userEvent.setup();
    const r = await renderWithProviders(<HeroContainerRight />, {
      seed: SEED,
      seedStore: (store) => {
        store.dispatch(
          replaceState(
            buildContainer([
              buildSession({ tabGroupId: SAMPLE, title: 'Sample' }),
            ])
          )
        );
        store.dispatch(selectTabContainer(SAMPLE));
        tourHere(store);
      },
    });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(listKeys(screen.getByRole('menu'))).not.toContain(OTHER_WAY);
    await user.keyboard('{Escape}');

    act(() => {
      r.store.dispatch(runStoppedHere());
    });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expectOtherWayFirst(
      screen.getByRole('menu'),
      'Open session in this window'
    );
  });
});
