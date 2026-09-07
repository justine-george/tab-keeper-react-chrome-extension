import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  setHasTabGroupsPermission,
  openSearchPanel,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import type { chromeTabGroupData } from '../../redux/slices/tabContainerDataStateSlice';

// The group row's full action set, wired through the UI rather than asserted
// on the reducers (which chromeGroupActions.test.ts already covers). What is
// under test here is that the row actually hands the right ids to the right
// action -- a correct reducer proves nothing about a miswired call site.

const TABS = [
  { tabId: 'loose', favicon: '', title: 'Loose', url: 'https://a.co' },
  {
    tabId: 'g1',
    favicon: '',
    title: 'One',
    url: 'https://b.co',
    chromeGroupId: 'grp',
  },
  {
    tabId: 'g2',
    favicon: '',
    title: 'Two',
    url: 'https://c.co',
    chromeGroupId: 'grp',
  },
];
const GROUPS: chromeTabGroupData[] = [
  { groupId: 'grp', title: 'Research', color: 'blue' },
];

async function renderRow({ isSearchPanel = false } = {}) {
  return renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg"
      windowId="w"
      tabs={TABS}
      chromeTabGroups={GROUPS}
      onWindowTitleClick={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seed: {
        tabs: [
          { id: 1, active: true, url: 'https://added.test', title: 'Added' },
        ],
      },
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        if (isSearchPanel) store.dispatch(openSearchPanel());
        store.dispatch(
          saveToTabContainerInternal({
            tabGroupId: 'tg',
            title: 'Session',
            createdTime: '2026-09-06 00:00:00',
            windowCount: 1,
            tabCount: 3,
            isAutoSave: false,
            isSelected: false,
            windows: [
              {
                windowId: 'w',
                windowHeight: 100,
                windowWidth: 100,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 3,
                title: 'Window 1',
                tabs: TABS,
                chromeTabGroups: GROUPS,
              },
            ],
          })
        );
      },
    }
  );
}

type S = Awaited<ReturnType<typeof renderRow>>['store'];
const win = (store: S) =>
  store.getState().tabContainerDataState.tabGroups[0].windows[0];

describe('the group row action set', () => {
  test('offers rename, add, and an overflow trigger', async () => {
    await renderRow();

    expect(
      screen.getByRole('button', { name: 'Rename group' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add current tab to group' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More actions' })
    ).toBeInTheDocument();
  });

  test('the overflow holds ungroup and delete', async () => {
    const user = userEvent.setup();
    await renderRow();

    await user.click(screen.getByRole('button', { name: 'More actions' }));

    expect(
      screen.getByRole('menuitem', { name: 'Ungroup' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Delete group' })
    ).toBeInTheDocument();
  });

  test('ungroup keeps the tabs and drops the grouping', async () => {
    const user = userEvent.setup();
    const { store } = await renderRow();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ungroup' }));

    expect(win(store).tabs).toHaveLength(3);
    expect(win(store).chromeTabGroups).toEqual([]);
  });

  test('delete group removes its tabs', async () => {
    const user = userEvent.setup();
    const { store } = await renderRow();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete group' }));

    expect(win(store).tabs.map((t) => t.tabId)).toEqual(['loose']);
  });

  test('add current tab puts it in the group, beside its members', async () => {
    const user = userEvent.setup();
    const { store } = await renderRow();

    await user.click(
      screen.getByRole('button', { name: 'Add current tab to group' })
    );

    const tabs = win(store).tabs;
    expect(tabs).toHaveLength(4);
    expect(tabs[3].chromeGroupId).toBe('grp');
    expect(tabs.map((t) => t.title)).toEqual(['Loose', 'One', 'Two', 'Added']);
  });

  // A control that cannot act must not be focusable and inert (KAN-62).
  test('the search panel withholds every group action', async () => {
    await renderRow({ isSearchPanel: true });

    expect(
      screen.queryByRole('button', { name: 'Rename group' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add current tab to group' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'More actions' })
    ).not.toBeInTheDocument();
  });

  // Pins the stacking-context fix. The action strip is centred with
  // transform: translateY(-50%), which makes it a stacking context and traps
  // the overflow menu's z-index inside it -- the menu painted BEHIND the tab
  // rows below. jsdom computes no paint order, so this cannot assert the
  // visual result; it asserts the property the fix turns on, which is the most
  // a jsdom test can hold. Verified visually in a real browser.
  test('the action strip lifts its own stacking context', async () => {
    await renderRow();

    const strip = document.querySelector('.group-rename-reveal');
    expect(strip).not.toBeNull();
    expect(getComputedStyle(strip as Element).zIndex).not.toBe('auto');
  });
});

// Two groups in one window, so sibling interactions are observable.
async function renderTwoGroups() {
  const tabs = [
    {
      tabId: 'a1',
      favicon: '',
      title: 'Learn one',
      url: 'https://a.co',
      chromeGroupId: 'g1',
    },
    {
      tabId: 'b1',
      favicon: '',
      title: 'Create one',
      url: 'https://b.co',
      chromeGroupId: 'g2',
    },
  ];
  const groups: chromeTabGroupData[] = [
    { groupId: 'g1', title: 'Learn', color: 'yellow' },
    { groupId: 'g2', title: 'Create', color: 'purple' },
  ];
  return renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg"
      windowId="w"
      tabs={tabs}
      chromeTabGroups={groups}
      onWindowTitleClick={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(
          saveToTabContainerInternal({
            tabGroupId: 'tg',
            title: 'Session',
            createdTime: '2026-09-06 00:00:00',
            windowCount: 1,
            tabCount: 2,
            isAutoSave: false,
            isSelected: false,
            windows: [
              {
                windowId: 'w',
                windowHeight: 100,
                windowWidth: 100,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 2,
                title: 'Window 1',
                tabs,
                chromeTabGroups: groups,
              },
            ],
          })
        );
      },
    }
  );
}

const stripFor = (groupName: string) => {
  const group = screen.getByRole('group', { name: groupName });
  return group.querySelector('.group-rename-reveal') as HTMLElement;
};

describe('two group rows in one window', () => {
  // Every strip carried the SAME z-index, so among siblings DOM order decided
  // and the LOWER group's action strip painted over the upper group's open
  // menu. Reproduced in a browser: the boxes overlap by 96x13px and the strip
  // won that region.
  test('the row whose menu is open outranks its siblings', async () => {
    const user = userEvent.setup();
    await renderTwoGroups();

    const before = getComputedStyle(stripFor('Learn')).zIndex;

    await user.click(
      screen.getAllByRole('button', { name: 'More actions' })[0]
    );

    const openStrip = Number(getComputedStyle(stripFor('Learn')).zIndex);
    const siblingStrip = Number(getComputedStyle(stripFor('Create')).zIndex);

    expect(openStrip).toBeGreaterThan(siblingStrip);
    // and it is the OPENING that lifts it, not a constant
    expect(String(openStrip)).not.toBe(before);
  });

  // THE CONTROL. The assertion above would also pass if every strip were
  // lifted permanently; this pins that a closed row does not outrank its
  // sibling, so the lift is tied to the menu being open.
  test('CONTROL: with nothing open, neither row outranks the other', async () => {
    await renderTwoGroups();

    expect(getComputedStyle(stripFor('Learn')).zIndex).toBe(
      getComputedStyle(stripFor('Create')).zIndex
    );
  });

  // Already true via the mousedown listener, but stated as an invariant here
  // so a later change to the dismiss mechanism cannot quietly allow two.
  test('opening one menu closes any other', async () => {
    const user = userEvent.setup();
    await renderTwoGroups();
    const triggers = screen.getAllByRole('button', { name: 'More actions' });

    await user.click(triggers[0]);
    expect(screen.getAllByRole('menu')).toHaveLength(1);

    await user.click(triggers[1]);

    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(triggers[0]).toHaveAttribute('aria-expanded', 'false');
    expect(triggers[1]).toHaveAttribute('aria-expanded', 'true');
  });
});

// The window row and every tab row fill with HOVER_COLOR under the pointer.
// The group header row, added in KAN-107, filled with nothing -- so hovering it
// revealed its actions on a row that gave no sign of being hovered.
//
// Both triggers, not just hover: this strip reveals its actions on :hover AND
// :focus-within, and KAN-100's rule is that reveal and fill are ONE visual
// state with one trigger. Filling on only one of them is exactly how they
// drifted apart before.
//
// No transition on the fill, for KAN-100's reason: the fill has to land in the
// same frame as anything painted over it, or the row fills in two halves with a
// visible edge between them.
describe('the group row fills like the rows around it', () => {
  const stripRules = (groupName: string) => {
    const group = screen.getByRole('group', { name: groupName });
    const strip = group.querySelector('.group-rename-reveal')
      ?.parentElement as HTMLElement;
    const classes = [...strip.classList].map((c) => `.${c}`);
    const out: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of [...rules]) {
        if (classes.some((c) => rule.cssText.includes(c)))
          out.push(rule.cssText);
      }
    }
    return out.join('\n');
  };

  const HOVER = /#E4E7EB|rgb\(228, ?231, ?235\)/i;

  test('fills under the pointer', async () => {
    await renderRow();
    const rules = stripRules('Research');

    const hoverBlock = rules
      .split('}')
      .find((b) => b.includes(':hover') && !b.includes('.group-rename-reveal'));

    expect(hoverBlock).toBeDefined();
    expect(hoverBlock).toMatch(HOVER);
  });

  test('fills when the keyboard reveals its actions', async () => {
    await renderRow();
    const rules = stripRules('Research');

    const focusBlock = rules
      .split('}')
      .find(
        (b) =>
          b.includes(':focus-within') && !b.includes('.group-rename-reveal')
      );

    expect(focusBlock).toBeDefined();
    expect(focusBlock).toMatch(HOVER);
  });

  // KAN-100: easing the fill lets the row arrive at the colour in two halves.
  test('does not ease the fill', async () => {
    await renderRow();

    expect(stripRules('Research')).not.toMatch(
      /transition[^;]*background-color/i
    );
  });
});

// The group header row stood 22px tall while the window row above it and every
// tab row below it are 32px, so its hover fill read as a short band wedged
// between full-height ones. Measured in a browser before the change: window 32,
// tab 32, group 22.
//
// 32px is also exactly the action icons' height, so they now fit the row
// instead of overflowing a shorter one and relying on absolute centring.
describe('the group row stands as tall as the rows around it', () => {
  test('reserves the same row height the window and tab rows use', async () => {
    await renderRow();

    const strip = screen
      .getByRole('group', { name: 'Research' })
      .querySelector('.group-rename-reveal')?.parentElement as HTMLElement;

    expect(getComputedStyle(strip).minHeight).toBe('32px');
  });
});
