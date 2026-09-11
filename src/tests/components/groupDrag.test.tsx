import { describe, expect, test, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  openSearchPanel,
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-160, through the real pane. jsdom has no layout and applies no App.css,
// so rows get boxes from a stub that reads the HELD marker at measure time: a
// group measures its title row plus its members, except the held one, which
// measures its title row alone. That is what a browser does, and it keeps the
// marker's "publish before measuring" ordering visible here. The fold itself,
// the hover cascade and scrolling are checked in e2e/group-drag.

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test`,
  ...(g ? { chromeGroupId: g } : {}),
});
const TABS = [
  tab('a0'),
  tab('g1a', 'alpha'),
  tab('g1b', 'alpha'),
  tab('a1'),
  tab('g2a', 'beta'),
  tab('g2b', 'beta'),
];
const GROUPS = [
  { groupId: 'alpha', title: 'Alpha', color: 'blue' },
  { groupId: 'beta', title: 'Beta', color: 'red' },
];

const render = ({ permission = true, search = false } = {}) =>
  renderWithProviders(<TabGroupDetailsContainer />, {
    seed: {
      tabs: [
        { id: 1, active: true, url: 'https://current.test', title: 'Current' },
      ],
    },
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(permission));
      store.dispatch(
        saveToTabContainerInternal({
          tabGroupId: 'tg',
          title: 'Session',
          createdTime: '2026-09-11 09:00:00',
          windowCount: 1,
          tabCount: 6,
          isAutoSave: false,
          isSelected: true,
          windows: [
            {
              windowId: 'w',
              windowHeight: 1080,
              windowWidth: 1920,
              windowOffsetTop: 0,
              windowOffsetLeft: 0,
              tabCount: 6,
              title: 'Window',
              tabs: TABS,
              chromeTabGroups: GROUPS,
            },
          ],
        })
      );
      store.dispatch(selectTabContainer('tg'));
      if (search) store.dispatch(openSearchPanel());
      store.dispatch(setIsNotDirty());
    },
  });

type R = Awaited<ReturnType<typeof render>>;

const box = (top: number, height: number) =>
  ({
    top,
    bottom: top + height,
    left: 0,
    right: 200,
    height,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;
const row = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`)!;
const handle = (c: HTMLElement, groupId: string) =>
  row(c, `group:${groupId}`).querySelector<HTMLElement>(
    '[data-group-drag-handle]'
  )!;

// [item id, member count]. Unheld: a0 [0,32) alpha [32,128) a1 [128,160) beta [160,256).
const ITEMS: [string, number][] = [
  ['tab:a0', 0],
  ['group:alpha', 2],
  ['tab:a1', 0],
  ['group:beta', 2],
];
const heightOf = (c: HTMLElement, id: string, members: number) =>
  32 + (row(c, id).hasAttribute('data-drag-held') ? 0 : members * 32);
const layoutItems = (c: HTMLElement) =>
  ITEMS.forEach(([id, members], i) => {
    row(c, id).getBoundingClientRect = () => {
      const top = ITEMS.slice(0, i).reduce(
        (sum, [other, m]) => sum + heightOf(c, other, m),
        0
      );
      return box(top, heightOf(c, id, members));
    };
  });
// Title-row centres before any drag.
const ALPHA_Y = 48;
const BETA_Y = 176;

// Open tabs, for the tab-drag control: a0 | Alpha title, g1a, g1b | a1 | Beta title, g2a, g2b
const layoutTabs = (c: HTMLElement) => {
  const tops: Record<string, number> = {
    a0: 0,
    g1a: 64,
    g1b: 96,
    a1: 128,
    g2a: 192,
    g2b: 224,
  };
  Object.entries(tops).forEach(
    ([id, top]) => (row(c, id).getBoundingClientRect = () => box(top, 32))
  );
  c.querySelector<HTMLElement>(
    '[data-band-id="alpha"]'
  )!.getBoundingClientRect = () => box(32, 96);
  c.querySelector<HTMLElement>('[data-band-id="beta"]')!.getBoundingClientRect =
    () => box(160, 96);
};

const press = (el: Element, y: number) =>
  fireEvent.pointerDown(el, { clientX: 10, clientY: y, button: 0 });
const moveTo = (y: number, x = 10) =>
  fireEvent.pointerMove(document, { clientX: x, clientY: y });
const release = (y: number, x = 10) =>
  fireEvent.pointerUp(document, { clientX: x, clientY: y });
const kind = () => document.documentElement.getAttribute('data-dragging');
const order = (store: R['store']) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows[0].tabs.map((t) => t.tabId);

afterEach(() => {
  release(0);
  document.documentElement.removeAttribute('data-dragging');
});

describe('which press starts which drag', () => {
  test('a press on a group title row starts a group drag, and marks only that group', async () => {
    const { container } = await render();
    layoutItems(container);
    press(handle(container, 'beta'), BETA_Y);
    moveTo(BETA_Y - 16);
    expect(kind()).toBe('group');
    expect(row(container, 'group:beta').hasAttribute('data-drag-held')).toBe(
      true
    );
    expect(row(container, 'group:alpha').hasAttribute('data-drag-held')).toBe(
      false
    );
  });

  test('a press on a tab starts a tab drag', async () => {
    const { container } = await render();
    layoutTabs(container);
    press(row(container, 'a0'), 16);
    moveTo(30);
    expect(kind()).toBe('tab');
  });

  // The colour bar is outside the handle and keeps opening its picker.
  test('a press and move on the colour bar starts no drag', async () => {
    const { container, store } = await render();
    layoutItems(container);
    press(
      screen.getByRole('button', { name: 'Change group color: Alpha' }),
      ALPHA_Y
    );
    moveTo(200);
    release(200);
    expect(kind()).toBeNull();
    expect(order(store)).toEqual(TABS.map((t) => t.tabId));
  });

  test('without the permission there is no group handle at all', async () => {
    const { container } = await render({ permission: false });
    expect(container.querySelector('[data-group-drag-handle]')).toBeNull();
  });

  test('in search mode a press on the title row starts nothing', async () => {
    const { container } = await render({ search: true });
    // PREMISE: an open panel with an empty box still draws the rows (KAN-140).
    // Without this, a missing row reads as "no drag" for the wrong reason.
    expect(
      container.querySelector(
        '[data-drag-row-id="group:beta"] [data-group-drag-handle]'
      )
    ).not.toBeNull();
    layoutItems(container);
    press(handle(container, 'beta'), BETA_Y);
    moveTo(10);
    expect(kind()).toBeNull();
  });
});

describe('the controls inside the handle keep their clicks', () => {
  test('a click on the pencil renames', async () => {
    const { container } = await render();
    await userEvent.click(
      within(row(container, 'group:alpha')).getByRole('button', {
        name: 'Rename group',
      })
    );
    expect(
      screen.getByRole('textbox', { name: 'Rename group: Alpha' })
    ).toBeTruthy();
  });

  test('a click on the overflow opens its menu', async () => {
    const { container } = await render();
    const more = within(row(container, 'group:alpha')).getByRole('button', {
      name: 'More actions',
    });
    await userEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  test('a click on the title opens the group', async () => {
    const { chrome } = await render();
    await userEvent.click(
      screen.getByRole('button', { name: 'Open group: Alpha' })
    );
    await waitFor(() =>
      expect(chrome.createdTabs.map((t) => t.url)).toEqual([
        'https://g1a.test',
        'https://g1b.test',
      ])
    );
  });

  // The click Chrome synthesizes after a drag lands on the title, and must
  // not open the group. Paired with the test above as its control.
  test('the click after a drag does not open the group', async () => {
    const { container, chrome } = await render();
    layoutItems(container);
    // Alpha held: a0 [0,32) alpha [32,64) a1 [64,96) beta [96,192). Past
    // beta's midpoint of 144 is the end.
    press(handle(container, 'alpha'), ALPHA_Y);
    moveTo(90);
    moveTo(160);
    release(160);
    fireEvent.click(screen.getByRole('button', { name: 'Open group: Alpha' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.createdTabs).toEqual([]);
  });

  // KAN-135 for groups. jsdom resolves no cascade, so this pins the
  // attribute the App.css rule keys on; the rendered opacity is an E2E check.
  test('the group action strip is marked as row actions', async () => {
    const { container } = await render();
    const pencil = within(row(container, 'group:alpha')).getByRole('button', {
      name: 'Rename group',
    });
    expect(pencil.closest('[data-row-actions]')).not.toBeNull();
    expect(pencil.closest('[data-group-drag-handle]')).not.toBeNull();
  });
});

describe('where a group drop lands', () => {
  // Beta held: a0 [0,32) alpha [32,128) a1 [128,160) beta [160,192).
  test('a drop between items moves the group, whole', async () => {
    const { container, store } = await render();
    layoutItems(container);
    press(handle(container, 'beta'), BETA_Y);
    moveTo(100);
    moveTo(10);
    release(10);
    expect(order(store)).toEqual(['g2a', 'g2b', 'a0', 'g1a', 'g1b', 'a1']);
  });

  // Main's pick-up rule is kept (KAN-161), so this holds only because the
  // fold never shrinks anything ABOVE the held group.
  test('a pick-up with no vertical travel changes nothing', async () => {
    const { container, store } = await render();
    layoutItems(container);
    press(handle(container, 'beta'), BETA_Y);
    moveTo(BETA_Y, 60);
    release(BETA_Y, 60);
    expect(order(store)).toEqual(TABS.map((t) => t.tabId));
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  test('a release outside the window is refused, and no item steps aside', async () => {
    const { container, store } = await render();
    layoutItems(container);
    press(handle(container, 'beta'), BETA_Y);
    moveTo(300);
    moveTo(400);
    const others = ['tab:a0', 'group:alpha', 'tab:a1'].map(
      (id) => row(container, id).style.transform
    );
    release(400);
    expect(others).toEqual(['', '', '']);
    expect(order(store)).toEqual(TABS.map((t) => t.tabId));
  });

  test('Escape cancels', async () => {
    const { container, store } = await render();
    layoutItems(container);
    press(handle(container, 'beta'), BETA_Y);
    moveTo(10);
    fireEvent.keyDown(window, { key: 'Escape' });
    release(10);
    expect(order(store)).toEqual(TABS.map((t) => t.tabId));
  });

  // CONTROL: nesting the group list did not take a tab drag's band rule away.
  test('CONTROL: a tab dropped on a band still joins that group', async () => {
    const { container, store } = await render();
    layoutTabs(container);
    press(row(container, 'a0'), 16);
    moveTo(60);
    moveTo(100);
    release(100);
    const a0 = store
      .getState()
      .tabContainerDataState.tabGroups[0].windows[0].tabs.find(
        (t) => t.tabId === 'a0'
      )!;
    expect(a0.chromeGroupId).toBe('alpha');
    expect(order(store)).toEqual(['g1a', 'a0', 'g1b', 'a1', 'g2a', 'g2b']);
  });
});
